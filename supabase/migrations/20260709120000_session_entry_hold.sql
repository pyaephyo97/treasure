-- ============================================================================
-- Treasure — "Hold Session" (temporary entry freeze, distinct from closing)
-- ============================================================================
-- Admin can now pause bet-entry submissions for everyone for N minutes
-- without closing the session (e.g. to freeze data mid-review). Unlike
-- auto-close, this doesn't need a pg_cron job to "undo" itself — it's a
-- plain timestamp comparison (now() < entry_hold_until) checked at
-- insert-time by both RLS and the submit_bet_entries RPC, so it naturally
-- expires the moment the clock passes it, with no server-side job required.
-- ============================================================================

alter table public.sessions add column entry_hold_until timestamptz;

-- Replace the bet-entry insert policy to also block while on hold (defense
-- in depth alongside the RPC's own check below).
drop policy if exists bet_entries_insert_own on public.bet_entries;
create policy bet_entries_insert_own on public.bet_entries
  for insert
  with check (
    user_id = public.current_account_id()
    and amount > 0
    and coalesce((select a.data_entry_open from public.accounts a where a.id = public.current_account_id()), true)
    and exists (
      select 1 from public.sessions s
      where s.id = bet_entries.session_id
        and s.status = 'open'
        and (s.entry_hold_until is null or now() >= s.entry_hold_until)
    )
    and coalesce(
      (select el.limit_value from public.entry_limits el
       where el.session_id = bet_entries.session_id
         and el.user_id = bet_entries.user_id
         and el.number = bet_entries.number),
      0
    ) >= (
      amount + coalesce(
        (select sum(be.amount) from public.bet_entries be
         where be.session_id = bet_entries.session_id
           and be.user_id = bet_entries.user_id
           and be.number = bet_entries.number),
        0
      )
    )
  );

-- Replace submit_bet_entries so a held session raises a clear, specific
-- error (rather than a generic RLS violation) before doing any per-row work.
create or replace function public.submit_bet_entries(p_session_id uuid, p_entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_id     uuid := public.current_account_id();
  v_caller_role   public.account_role := public.current_role();
  v_data_entry_open boolean;
  v_session       record;
  v_entry         jsonb;
  v_idx           integer := 0;
  v_number        text;
  v_amount        integer;
  v_limit         integer;
  v_existing      integer;
  v_remaining     integer;
  v_new_id        uuid;
  v_results       jsonb := '[]'::jsonb;
  v_inserted      integer := 0;
begin
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_caller_role <> 'user' then
    raise exception 'Only user accounts can submit bet entries';
  end if;

  select data_entry_open into v_data_entry_open from public.accounts where id = v_caller_id;
  if v_data_entry_open is false then
    raise exception 'Your data entry has been closed by the admin for this session';
  end if;

  select * into v_session from public.sessions where id = p_session_id;
  if not found then
    raise exception 'Session not found';
  end if;

  if v_session.status <> 'open' then
    raise exception 'Session is closed';
  end if;

  if v_session.entry_hold_until is not null and now() < v_session.entry_hold_until then
    raise exception 'Entry is temporarily held by the admin. Try again in a few minutes.';
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

    select limit_value into v_limit
    from public.entry_limits
    where session_id = p_session_id
      and user_id = v_caller_id
      and number = v_number
    for update;

    if not found then
      v_limit := 0;
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
$function$;
