-- ============================================================================
-- Treasure — Phase 1 — Atomic RPC Functions
-- (backs the create-account / validate-bet-entry / distribute-over-limit /
-- calculate-pnl Edge Functions from spec §7.3)
-- ============================================================================
--
-- Why RPC functions instead of doing this purely in Edge Function code:
-- the limit check on bet entries and the over-limit distribution both need
-- to be atomic / race-safe across concurrent requests. That's much safer
-- done as a single SQL statement (one transaction, with row locks) than as
-- multiple round-trips from an Edge Function. So the pattern here is:
--   Edge Function = thin wrapper (parses request, forwards caller's JWT,
--                    calls the RPC, shapes the HTTP response)
--   SQL function  = the actual atomic, authoritative business logic
--
-- FLAGGED ASSUMPTIONS — please confirm, these are real judgment calls:
--
-- (A) Admin's Commission Total (calculate_pnl) is computed on each managed
--     user's FULL gross bet contribution this session, regardless of how
--     much of it Admin later shared away to partners. Rationale: spec §4.1
--     says commission is "a discount on gross bet intake for each user" —
--     tied to the user's own gross, not to whatever Admin does with the
--     aggregate afterward.
--
-- (B) Admin's Payout (calculate_pnl) — the spec never gives Admin its own
--     payout_rate field (only User and Partner accounts have one), but says
--     "each party pays out only from their own held data." Since bet_entries
--     are user-attributed but over-limit sharing happens in an aggregate
--     per-number amount (not per-user), we cannot always know exactly whose
--     contribution to a number was the part shared away when multiple users
--     fed the same number. Implemented resolution: Admin's payout for the
--     winning number = (Admin's held amount on that number) x (a WEIGHTED
--     AVERAGE of the contributing users' own payout_rate, weighted by their
--     gross contribution to that number). This uses only data that actually
--     exists in the schema and degrades to the simple case when all
--     contributing users share the same payout_rate. If the intent was
--     something else (e.g. Admin having its own separate payout_rate,
--     or FIFO/LIFO attribution of which user's money was shared), this
--     needs to be revisited.
-- ============================================================================


-- ============================================================================
-- 1. submit_bet_entries — atomic, race-safe bulk bet entry submission
-- ============================================================================
create or replace function public.submit_bet_entries(
  p_session_id uuid,
  p_entries jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id   uuid := public.current_account_id();
  v_caller_role public.account_role := public.current_role();
  v_session     record;
  v_entry       jsonb;
  v_idx         integer := 0;
  v_number      text;
  v_amount      integer;
  v_limit       integer;
  v_existing    integer;
  v_remaining   integer;
  v_new_id      uuid;
  v_results     jsonb := '[]'::jsonb;
  v_inserted    integer := 0;
begin
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_caller_role <> 'user' then
    raise exception 'Only user accounts can submit bet entries';
  end if;

  select * into v_session from public.sessions where id = p_session_id;
  if not found then
    raise exception 'Session not found';
  end if;

  if v_session.status <> 'open' then
    raise exception 'Session is closed';
  end if;

  if jsonb_typeof(p_entries) <> 'array' then
    raise exception 'p_entries must be a JSON array of {number, amount}';
  end if;

  for v_entry in select * from jsonb_array_elements(p_entries)
  loop
    v_idx := v_idx + 1;
    v_number := v_entry ->> 'number';

    begin
      v_amount := (v_entry ->> 'amount')::integer;
    exception when others then
      v_amount := null;
    end;

    if v_number is null or v_number !~ '^[0-9]{2}$' then
      v_results := v_results || jsonb_build_object(
        'line', v_idx, 'number', v_number, 'amount', v_entry ->> 'amount',
        'status', 'error', 'message', 'Invalid number format, must be 00-99'
      );
      continue;
    end if;

    if v_amount is null or v_amount <= 0 then
      v_results := v_results || jsonb_build_object(
        'line', v_idx, 'number', v_number, 'amount', v_entry ->> 'amount',
        'status', 'error', 'message', 'Amount must be a positive integer'
      );
      continue;
    end if;

    -- Lock the entry_limits row for this (session, user, number) so
    -- concurrent submissions for the same number serialize on this row
    -- instead of racing on the SUM check below.
    select limit_value into v_limit
    from public.entry_limits
    where session_id = p_session_id
      and user_id = v_caller_id
      and number = v_number
    for update;

    if not found then
      v_limit := 0; -- no limit assigned yet => block by default
    end if;

    select coalesce(sum(amount), 0) into v_existing
    from public.bet_entries
    where session_id = p_session_id
      and user_id = v_caller_id
      and number = v_number;

    v_remaining := v_limit - v_existing;

    if v_amount > v_remaining then
      v_results := v_results || jsonb_build_object(
        'line', v_idx, 'number', v_number, 'amount', v_amount,
        'status', 'error',
        'message', format('Limit exceeded for number %s. Remaining: %s', v_number, greatest(v_remaining, 0)),
        'remaining', greatest(v_remaining, 0)
      );
      continue;
    end if;

    insert into public.bet_entries (session_id, user_id, number, amount)
    values (p_session_id, v_caller_id, v_number, v_amount)
    returning id into v_new_id;

    v_inserted := v_inserted + 1;

    v_results := v_results || jsonb_build_object(
      'line', v_idx, 'number', v_number, 'amount', v_amount,
      'status', 'ok', 'entry_id', v_new_id
    );
  end loop;

  return jsonb_build_object(
    'results', v_results,
    'inserted_count', v_inserted
  );
end;
$$;

revoke all on function public.submit_bet_entries(uuid, jsonb) from public;
grant execute on function public.submit_bet_entries(uuid, jsonb) to authenticated;


-- ============================================================================
-- 2. distribute_over_limit — compute (dry_run) or execute a share action
-- ============================================================================
create or replace function public.distribute_over_limit(
  p_session_id uuid,
  p_share_method text,
  p_set_limit integer,
  p_partner_ids uuid[] default null,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id        uuid := public.current_account_id();
  v_caller_role      public.account_role := public.current_role();
  v_session          record;
  v_eligible         jsonb;
  v_eligible_count   integer;
  v_breakdown        jsonb := '[]'::jsonb;
  v_total_shared     integer := 0;
  v_pct_sum          numeric;
  v_partner_count    integer;
  v_share_history_id uuid;
  r                  record;
  v_partner          record;
  v_amt              integer;
begin
  if v_caller_id is null or v_caller_role not in ('admin', 'master_admin') then
    raise exception 'Only admin or master_admin can distribute over-limit data';
  end if;

  if p_share_method not in ('percentage', 'equally') then
    raise exception 'share_method must be percentage or equally';
  end if;

  select * into v_session from public.sessions where id = p_session_id;
  if not found then
    raise exception 'Session not found';
  end if;
  if v_session.status <> 'open' then
    raise exception 'Session is closed';
  end if;

  -- Eligible over-limit numbers = total (this admin's managed users) minus
  -- set_limit minus whatever has already been handled by prior share
  -- actions this session (so previously-shared rows don't get re-shared).
  with totals as (
    select be.number, sum(be.amount)::integer as total_amount
    from public.bet_entries be
    join public.accounts u on u.id = be.user_id
    where be.session_id = p_session_id
      and public.managed_by_current_admin(u.id)
    group by be.number
  ),
  handled as (
    select olr.number, sum(olr.over_limit_amount)::integer as handled_amount
    from public.over_limit_records olr
    where olr.session_id = p_session_id
    group by olr.number
  ),
  eligible as (
    select
      t.number,
      t.total_amount,
      p_set_limit as limit_value,
      greatest(t.total_amount - p_set_limit - coalesce(h.handled_amount, 0), 0) as over_limit_amount
    from totals t
    left join handled h on h.number = t.number
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'number', number, 'total_amount', total_amount,
      'limit_value', limit_value, 'over_limit_amount', over_limit_amount
    )), '[]'::jsonb),
    count(*)
  into v_eligible, v_eligible_count
  from eligible
  where over_limit_amount > 0;

  if v_eligible_count = 0 then
    return jsonb_build_object(
      'share_method', p_share_method, 'set_limit', p_set_limit,
      'eligible_numbers', '[]'::jsonb, 'breakdown', '[]'::jsonb,
      'total_shared_amount', 0, 'dry_run', p_dry_run,
      'message', 'No numbers are currently over limit.'
    );
  end if;

  if p_share_method = 'percentage' then
    select coalesce(sum(data_share_percentage), 0) into v_pct_sum
    from public.accounts
    where role = 'partner' and is_active = true and public.managed_by_current_admin(id);

    if v_pct_sum <> 100 then
      raise exception 'Active partner share percentages must sum to 100 (currently %)', v_pct_sum;
    end if;

    for r in
      select * from jsonb_to_recordset(v_eligible)
        as x(number text, total_amount integer, limit_value integer, over_limit_amount integer)
    loop
      for v_partner in
        select id, username, data_share_percentage
        from public.accounts
        where role = 'partner' and is_active = true and public.managed_by_current_admin(id)
      loop
        v_amt := round(r.over_limit_amount * v_partner.data_share_percentage / 100.0);
        if v_amt > 0 then
          v_breakdown := v_breakdown || jsonb_build_object(
            'number', r.number, 'partner_id', v_partner.id,
            'partner_username', v_partner.username, 'shared_amount', v_amt
          );
          v_total_shared := v_total_shared + v_amt;
        end if;
      end loop;
    end loop;

  else -- equally
    if p_partner_ids is null or coalesce(array_length(p_partner_ids, 1), 0) = 0 then
      raise exception 'Select at least one partner for equal-split sharing';
    end if;

    select count(*) into v_partner_count
    from public.accounts
    where id = any(p_partner_ids) and role = 'partner' and is_active = true
      and public.managed_by_current_admin(id);

    if v_partner_count = 0 then
      raise exception 'No valid, active partners found for the given ids';
    end if;

    for r in
      select * from jsonb_to_recordset(v_eligible)
        as x(number text, total_amount integer, limit_value integer, over_limit_amount integer)
    loop
      for v_partner in
        select id, username
        from public.accounts
        where id = any(p_partner_ids) and role = 'partner' and is_active = true
          and public.managed_by_current_admin(id)
      loop
        v_amt := floor(r.over_limit_amount::numeric / v_partner_count);
        if v_amt > 0 then
          v_breakdown := v_breakdown || jsonb_build_object(
            'number', r.number, 'partner_id', v_partner.id,
            'partner_username', v_partner.username, 'shared_amount', v_amt
          );
          v_total_shared := v_total_shared + v_amt;
        end if;
      end loop;
    end loop;
  end if;

  if p_dry_run then
    return jsonb_build_object(
      'share_method', p_share_method, 'set_limit', p_set_limit,
      'eligible_numbers', v_eligible, 'breakdown', v_breakdown,
      'total_shared_amount', v_total_shared, 'dry_run', true
    );
  end if;

  insert into public.share_history (session_id, share_method, set_limit_used, total_shared_amount, created_by)
  values (p_session_id, p_share_method::public.share_method_type, p_set_limit, v_total_shared, v_caller_id)
  returning id into v_share_history_id;

  insert into public.over_limit_records (share_history_id, session_id, number, total_amount, limit_value, over_limit_amount)
  select v_share_history_id, p_session_id, (e ->> 'number'), (e ->> 'total_amount')::integer,
         (e ->> 'limit_value')::integer, (e ->> 'over_limit_amount')::integer
  from jsonb_array_elements(v_eligible) e;

  insert into public.partner_shares (share_history_id, session_id, partner_id, number, shared_amount)
  select v_share_history_id, p_session_id, (e ->> 'partner_id')::uuid, (e ->> 'number'), (e ->> 'shared_amount')::integer
  from jsonb_array_elements(v_breakdown) e;

  return jsonb_build_object(
    'share_method', p_share_method, 'set_limit', p_set_limit,
    'eligible_numbers', v_eligible, 'breakdown', v_breakdown,
    'total_shared_amount', v_total_shared, 'dry_run', false,
    'share_history_id', v_share_history_id
  );
end;
$$;

revoke all on function public.distribute_over_limit(uuid, text, integer, uuid[], boolean) from public;
grant execute on function public.distribute_over_limit(uuid, text, integer, uuid[], boolean) to authenticated;


-- ============================================================================
-- 3. calculate_pnl — read-time P&L for a User, Partner, or Admin (see §4.3)
-- ============================================================================
create or replace function public.calculate_pnl(
  p_session_id uuid,
  p_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id     uuid := public.current_account_id();
  v_target_id     uuid := coalesce(p_account_id, v_caller_id);
  v_target        record;
  v_session       record;
  v_gross         numeric := 0;
  v_commission    numeric := 0;
  v_net_intake    numeric := 0;
  v_payout_basis  numeric := 0;
  v_weighted_rate numeric := 0;
  v_payout        numeric := 0;
  v_net_pnl       numeric;
  v_win_set       boolean;
begin
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_target_id <> v_caller_id and not public.managed_by_current_admin(v_target_id) then
    raise exception 'Not authorized to view this account''s P&L';
  end if;

  select * into v_target from public.accounts where id = v_target_id;
  if not found then
    raise exception 'Account not found';
  end if;

  select * into v_session from public.sessions where id = p_session_id;
  if not found then
    raise exception 'Session not found';
  end if;

  v_win_set := v_session.winning_number is not null;

  if v_target.role = 'user' then
    select coalesce(sum(amount), 0) into v_gross
    from public.bet_entries
    where session_id = p_session_id and user_id = v_target_id;

    v_commission := v_gross * v_target.commission_rate / 100.0;
    v_net_intake := v_gross - v_commission;

    if v_win_set then
      select coalesce(sum(amount), 0) into v_payout_basis
      from public.bet_entries
      where session_id = p_session_id and user_id = v_target_id
        and number = v_session.winning_number;
      v_payout := v_payout_basis * v_target.payout_rate;
    end if;

  elsif v_target.role = 'partner' then
    select coalesce(sum(shared_amount), 0) into v_gross
    from public.partner_shares
    where session_id = p_session_id and partner_id = v_target_id;

    v_commission := v_gross * v_target.commission_rate / 100.0;
    v_net_intake := v_gross - v_commission;

    if v_win_set then
      select coalesce(sum(shared_amount), 0) into v_payout_basis
      from public.partner_shares
      where session_id = p_session_id and partner_id = v_target_id
        and number = v_session.winning_number;
      v_payout := v_payout_basis * v_target.payout_rate;
    end if;

  else -- admin or master_admin — see assumptions (A) and (B) at the top of this file
    declare
      v_total_data       numeric := 0;
      v_shared_away      numeric := 0;
      v_win_total        numeric := 0;
      v_win_shared       numeric := 0;
      v_win_weighted_num numeric := 0;
    begin
      select coalesce(sum(be.amount), 0) into v_total_data
      from public.bet_entries be
      join public.accounts u on u.id = be.user_id
      where be.session_id = p_session_id and public.managed_by_current_admin(u.id);

      select coalesce(sum(ps.shared_amount), 0) into v_shared_away
      from public.partner_shares ps
      join public.share_history sh on sh.id = ps.share_history_id
      where ps.session_id = p_session_id and sh.created_by = v_target_id;

      v_gross := v_total_data - v_shared_away;

      select coalesce(sum(be.amount * u.commission_rate / 100.0), 0) into v_commission
      from public.bet_entries be
      join public.accounts u on u.id = be.user_id
      where be.session_id = p_session_id and public.managed_by_current_admin(u.id);

      v_net_intake := v_gross - v_commission;

      if v_win_set then
        select coalesce(sum(be.amount), 0), coalesce(sum(be.amount * u.payout_rate), 0)
        into v_win_total, v_win_weighted_num
        from public.bet_entries be
        join public.accounts u on u.id = be.user_id
        where be.session_id = p_session_id and public.managed_by_current_admin(u.id)
          and be.number = v_session.winning_number;

        select coalesce(sum(ps.shared_amount), 0) into v_win_shared
        from public.partner_shares ps
        join public.share_history sh on sh.id = ps.share_history_id
        where ps.session_id = p_session_id and sh.created_by = v_target_id
          and ps.number = v_session.winning_number;

        v_payout_basis := v_win_total - v_win_shared;

        if v_win_total > 0 then
          v_weighted_rate := v_win_weighted_num / v_win_total;
        else
          v_weighted_rate := 0;
        end if;

        v_payout := v_payout_basis * v_weighted_rate;
      end if;
    end;
  end if;

  v_net_pnl := case when v_win_set then v_net_intake - v_payout else null end;

  return jsonb_build_object(
    'account_id', v_target_id,
    'role', v_target.role,
    'session_id', p_session_id,
    'winning_number_set', v_win_set,
    'winning_number', v_session.winning_number,
    'gross_intake', round(v_gross),
    'commission_total', round(v_commission),
    'net_intake', round(v_net_intake),
    'payout', case when v_win_set then round(v_payout) else null end,
    'net_pnl', case when v_win_set then round(v_net_pnl) else null end
  );
end;
$$;

revoke all on function public.calculate_pnl(uuid, uuid) from public;
grant execute on function public.calculate_pnl(uuid, uuid) to authenticated;
