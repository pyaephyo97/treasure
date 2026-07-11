-- ============================================================================
-- Treasure — persist Partner's "My Sub-Limit" (fixes reset-to-default-on-
-- reload bug, same root cause as the earlier Admin Total Data Limit
-- Threshold fix: it was ephemeral component state instead of a stored value).
-- ============================================================================
-- Stored on the partner's own accounts row (not the session row, unlike
-- Admin's total_data_set_limit) — this is the partner's own standing
-- preference, not a per-session decision made by someone else, so it should
-- persist across sessions too, not just reloads within one.
--
-- accounts_update_managed only lets the owning Admin/Master Admin update a
-- managed account, so a partner can't UPDATE their own row directly under
-- existing RLS — hence the small SECURITY DEFINER RPC below, scoped to just
-- this one column on just the caller's own row.
-- ============================================================================

alter table public.accounts add column sub_limit_value integer;

create or replace function public.set_my_sub_limit(p_value integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_id   uuid := public.current_account_id();
  v_caller_role public.account_role := public.current_role();
begin
  if v_caller_id is null or v_caller_role <> 'partner' then
    raise exception 'Only partner accounts can set their own sub-limit';
  end if;

  if p_value is null or p_value < 0 then
    raise exception 'sub-limit must be a non-negative number';
  end if;

  update public.accounts set sub_limit_value = p_value where id = v_caller_id;
end;
$function$;
