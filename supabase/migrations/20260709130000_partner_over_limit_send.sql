-- ============================================================================
-- Treasure — Partner-side "Send" for over-sub-limit amounts
-- ============================================================================
-- Mirrors Admin's share_history / over_limit_records pattern, but scoped to
-- a single partner: when a Partner presses "Send" on their Over My Limit
-- panel, the currently-outstanding over-sub-limit amount per number (total
-- received via partner_shares, minus whatever they've already sent before)
-- is archived into partner_over_limit_history / partner_over_limit_records,
-- which is what makes it disappear from the live panel and reappear as a
-- copyable History entry.
-- ============================================================================

create table public.partner_over_limit_history (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  partner_id uuid not null references public.accounts(id) on delete cascade,
  sub_limit_used integer not null,
  total_sent_amount integer not null,
  created_at timestamptz not null default now()
);

create table public.partner_over_limit_records (
  id uuid primary key default gen_random_uuid(),
  history_id uuid not null references public.partner_over_limit_history(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  partner_id uuid not null references public.accounts(id) on delete cascade,
  number text not null,
  total_received integer not null,
  sub_limit_value integer not null,
  over_limit_amount integer not null,
  created_at timestamptz not null default now()
);

alter table public.partner_over_limit_history enable row level security;
alter table public.partner_over_limit_records enable row level security;

create policy partner_over_limit_history_select on public.partner_over_limit_history
  for select using (partner_id = public.current_account_id() or public.is_admin_or_above());

create policy partner_over_limit_records_select on public.partner_over_limit_records
  for select using (partner_id = public.current_account_id() or public.is_admin_or_above());

-- Both new tables need to be in the realtime publication too — see the
-- 20260707170000_enable_realtime_publication.sql migration note: any table
-- not explicitly added here silently never delivers postgres_changes events.
alter publication supabase_realtime add table
  public.partner_over_limit_history,
  public.partner_over_limit_records;

create or replace function public.send_partner_over_limit(p_session_id uuid, p_sub_limit integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_id      uuid := public.current_account_id();
  v_caller_role    public.account_role := public.current_role();
  v_session        record;
  v_eligible       jsonb;
  v_eligible_count integer;
  v_total          integer := 0;
  v_history_id     uuid;
begin
  if v_caller_id is null or v_caller_role <> 'partner' then
    raise exception 'Only partner accounts can send over-limit data';
  end if;

  if p_sub_limit is null or p_sub_limit < 0 then
    raise exception 'sub_limit must be a non-negative number';
  end if;

  select * into v_session from public.sessions where id = p_session_id;
  if not found then
    raise exception 'Session not found';
  end if;

  with totals as (
    select ps.number, sum(ps.shared_amount)::integer as total_received
    from public.partner_shares ps
    where ps.session_id = p_session_id and ps.partner_id = v_caller_id
    group by ps.number
  ),
  already_sent as (
    select r.number, sum(r.over_limit_amount)::integer as sent_amount
    from public.partner_over_limit_records r
    where r.session_id = p_session_id and r.partner_id = v_caller_id
    group by r.number
  ),
  eligible as (
    select
      t.number,
      t.total_received,
      p_sub_limit as sub_limit_value,
      greatest(t.total_received - p_sub_limit - coalesce(a.sent_amount, 0), 0) as over_limit_amount
    from totals t
    left join already_sent a on a.number = t.number
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'number', number, 'total_received', total_received,
      'sub_limit_value', sub_limit_value, 'over_limit_amount', over_limit_amount
    ) order by number), '[]'::jsonb),
    count(*),
    coalesce(sum(over_limit_amount), 0)
  into v_eligible, v_eligible_count, v_total
  from eligible
  where over_limit_amount > 0;

  if v_eligible_count = 0 then
    return jsonb_build_object(
      'eligible_numbers', '[]'::jsonb, 'total_sent_amount', 0,
      'message', 'No over-limit amount to send right now.'
    );
  end if;

  insert into public.partner_over_limit_history (session_id, partner_id, sub_limit_used, total_sent_amount)
  values (p_session_id, v_caller_id, p_sub_limit, v_total)
  returning id into v_history_id;

  insert into public.partner_over_limit_records (history_id, session_id, partner_id, number, total_received, sub_limit_value, over_limit_amount)
  select v_history_id, p_session_id, v_caller_id, (e ->> 'number'), (e ->> 'total_received')::integer,
         (e ->> 'sub_limit_value')::integer, (e ->> 'over_limit_amount')::integer
  from jsonb_array_elements(v_eligible) e;

  return jsonb_build_object(
    'eligible_numbers', v_eligible, 'total_sent_amount', v_total, 'history_id', v_history_id
  );
end;
$function$;
