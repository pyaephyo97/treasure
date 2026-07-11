-- ============================================================================
-- Treasure — fix calculate_pnl: Admin's own P&L must use their OWN account
-- commission_rate / payout_rate, not an aggregate of their managed users'
-- individual rates.
-- ============================================================================
-- Previously, the admin/master_admin branch computed "Commission Total" as
-- sum(bet_amount * that_user's_commission_rate) across every managed user,
-- and "Payout" as a bet-weighted average of every managed user's
-- payout_rate — completely ignoring the ADMIN's own accounts.commission_rate
-- / payout_rate. That means the rates an Admin sets on their own Profile
-- page (set_my_admin_rates) had zero effect on their own P&L report. This
-- now mirrors the user/partner branches: apply the target admin's own rate
-- directly to their gross intake and winning-number payout basis.
-- ============================================================================

create or replace function public.calculate_pnl(p_session_id uuid, p_account_id uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_id     uuid := public.current_account_id();
  v_target_id     uuid := coalesce(p_account_id, v_caller_id);
  v_target        record;
  v_session       record;
  v_gross         numeric := 0;
  v_commission    numeric := 0;
  v_net_intake    numeric := 0;
  v_payout_basis  numeric := 0;
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

  else -- admin or master_admin — now uses the admin's OWN commission_rate / payout_rate
    declare
      v_total_data  numeric := 0;
      v_shared_away numeric := 0;
      v_win_total   numeric := 0;
      v_win_shared  numeric := 0;
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

      -- Admin's own commission rate applied to their gross intake — matches
      -- the user/partner branches above, and is what set_my_admin_rates /
      -- admin/AdminProfile.tsx actually controls.
      v_commission := v_gross * v_target.commission_rate / 100.0;
      v_net_intake := v_gross - v_commission;

      if v_win_set then
        select coalesce(sum(be.amount), 0) into v_win_total
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
        v_payout := v_payout_basis * v_target.payout_rate;
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
$function$;
