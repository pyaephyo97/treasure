-- ============================================================================
-- Treasure — Admin "Delete History" (clear a past session's data by name)
-- ============================================================================
-- Admin/Master Admin can permanently wipe a session's transactional data —
-- user-submitted bet entries and admin share-to-partner records — without
-- deleting the session row itself, so it stays selectable in the "pick a
-- session by name" pickers (now just showing zero data/history for it).
--
-- Scope, mirroring the same managed_by_current_admin() isolation already
-- used by distribute_over_limit:
--   - bet_entries: only rows belonging to users managed by the calling
--     admin are deleted, UNLESS the caller is master_admin (deletes every
--     managed admin's users' entries for that session).
--   - share_history (created_by = caller) — cascades automatically to
--     over_limit_records and partner_shares via their existing
--     `on delete cascade` FK to share_history_id, so those never need to be
--     targeted directly. Master Admin deletes every admin's share actions
--     for that session.
--
-- Deliberately NOT touched: entry_limits (per-number caps are ongoing
-- config, not history), warning_messages (unrelated to data entry/sharing),
-- partner_over_limit_history/_records (a Partner's own later "Send" action
-- on data they already received — a separate downstream concern from what
-- the Admin shared; left as-is, may reference numbers whose original share
-- was cleared, same as any other historical record once its source data is
-- gone. See PROJECT_SPEC.md Known Gaps).
--
-- p_dry_run mirrors the distribute_over_limit / send_partner_over_limit
-- preview-then-confirm pattern already established elsewhere in this app:
-- the UI calls once with dry_run = true to show counts before the Admin
-- confirms, then again with dry_run = false to actually delete.
-- ============================================================================

create or replace function public.delete_session_history(
  p_session_id uuid,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id    uuid := public.current_account_id();
  v_caller_role  public.account_role := public.current_role();
  v_is_master    boolean := public.is_master_admin();
  v_bet_count    integer := 0;
  v_share_count  integer := 0;
  v_share_amount integer := 0;
begin
  if v_caller_id is null or v_caller_role not in ('admin', 'master_admin') then
    raise exception 'Only admin or master_admin can delete session history';
  end if;

  if not exists (select 1 from public.sessions where id = p_session_id) then
    raise exception 'Session not found';
  end if;

  select count(*)
  into v_bet_count
  from public.bet_entries be
  join public.accounts u on u.id = be.user_id
  where be.session_id = p_session_id
    and (v_is_master or public.managed_by_current_admin(u.id));

  select count(*), coalesce(sum(sh.total_shared_amount), 0)
  into v_share_count, v_share_amount
  from public.share_history sh
  where sh.session_id = p_session_id
    and (v_is_master or sh.created_by = v_caller_id);

  if p_dry_run then
    return jsonb_build_object(
      'session_id', p_session_id,
      'bet_entries_count', v_bet_count,
      'share_history_count', v_share_count,
      'total_shared_amount', v_share_amount,
      'dry_run', true
    );
  end if;

  delete from public.bet_entries be
  using public.accounts u
  where be.session_id = p_session_id
    and be.user_id = u.id
    and (v_is_master or public.managed_by_current_admin(u.id));

  -- over_limit_records and partner_shares cascade automatically (both have
  -- `on delete cascade` on their share_history_id FK — see init_schema.sql).
  delete from public.share_history sh
  where sh.session_id = p_session_id
    and (v_is_master or sh.created_by = v_caller_id);

  return jsonb_build_object(
    'session_id', p_session_id,
    'bet_entries_count', v_bet_count,
    'share_history_count', v_share_count,
    'total_shared_amount', v_share_amount,
    'dry_run', false
  );
end;
$$;

revoke all on function public.delete_session_history(uuid, boolean) from public;
grant execute on function public.delete_session_history(uuid, boolean) to authenticated;
