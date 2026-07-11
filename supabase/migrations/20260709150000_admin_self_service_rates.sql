-- ============================================================================
-- Treasure — Admin self-service Profile (own commission rate / payout rate)
-- ============================================================================
-- accounts_update_managed only lets the OWNER (Master Admin, or the Admin
-- who created a given sub-account) update that row — an Admin has never
-- been able to update their OWN row (they didn't create themselves; Master
-- Admin did). This RPC opens a narrow, self-scoped exception: an admin or
-- master_admin caller may update only commission_rate/payout_rate, and only
-- on their own row.
-- ============================================================================

create or replace function public.set_my_admin_rates(p_commission_rate numeric, p_payout_rate integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_id   uuid := public.current_account_id();
  v_caller_role public.account_role := public.current_role();
begin
  if v_caller_id is null or v_caller_role not in ('admin', 'master_admin') then
    raise exception 'Only admin or master_admin accounts can set their own rates';
  end if;

  if p_commission_rate is null or p_commission_rate < 0 or p_commission_rate > 100 then
    raise exception 'Commission rate must be between 0 and 100';
  end if;

  if p_payout_rate is null or p_payout_rate < 1 then
    raise exception 'Payout rate must be a positive number';
  end if;

  update public.accounts
  set commission_rate = p_commission_rate, payout_rate = p_payout_rate
  where id = v_caller_id;
end;
$function$;
