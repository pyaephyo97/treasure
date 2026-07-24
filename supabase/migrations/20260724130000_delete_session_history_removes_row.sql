-- ============================================================================
-- Treasure — Delete History now also removes the session row itself
-- ============================================================================
-- Previously delete_session_history only cleared a session's bet_entries and
-- share_history (see 20260724120000_delete_session_history.sql), leaving the
-- session row behind on purpose so it stayed selectable in history pickers.
-- The account owner doesn't want that — a deleted session's row should not
-- linger. This migration replaces the function so a real (non-dry-run) call
-- also deletes the sessions row once its data is cleared.
--
-- The row can only actually be removed once NOTHING references it anymore,
-- session-wide — not just the calling admin's own slice:
--   - entry_limits and partner_over_limit_history/_records already cascade
--     automatically via their own `on delete cascade` FK to sessions.id, so
--     deleting the session row cleans those up for free.
--   - bet_entries, share_history (which itself cascades to
--     over_limit_records/partner_shares via share_history_id), and
--     warning_messages (which cascades to session_targets) do NOT cascade
--     from sessions and must be deleted first — scoped exactly like before
--     (a regular Admin only touches their own managed users' bet_entries and
--     their own share_history/warning_messages; Master Admin's scope is
--     everything).
--
-- If the calling Admin's scope doesn't cover 100% of what's attached to the
-- session (e.g. a DIFFERENT admin's users also bet in this shared session),
-- the row deletion is wrapped in its own sub-block and simply left alone on
-- a foreign_key_violation — the admin's own data still gets cleared, the
-- session row just can't be fully retired yet because someone else's data
-- still legitimately points at it. Master Admin's scope is always
-- everything, so their delete always succeeds in removing the row too.
--
-- The dry-run preview now also predicts this via `will_remove_session`,
-- computed by comparing the caller's scoped counts against the session's
-- TOTAL (unscoped) counts — equal on all three means nothing outside the
-- caller's scope remains, so the real delete's row removal will succeed.
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
  v_caller_id           uuid := public.current_account_id();
  v_caller_role         public.account_role := public.current_role();
  v_is_master           boolean := public.is_master_admin();
  v_bet_count           integer := 0;
  v_share_count         integer := 0;
  v_share_amount        integer := 0;
  v_warning_count       integer := 0;
  v_total_bet_count     integer := 0;
  v_total_share_count   integer := 0;
  v_total_warning_count integer := 0;
  v_will_remove_session boolean := false;
  v_session_deleted     boolean := false;
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

  select count(*)
  into v_warning_count
  from public.warning_messages w
  where w.session_id = p_session_id
    and (v_is_master or w.created_by = v_caller_id);

  select count(*) into v_total_bet_count from public.bet_entries where session_id = p_session_id;
  select count(*) into v_total_share_count from public.share_history where session_id = p_session_id;
  select count(*) into v_total_warning_count from public.warning_messages where session_id = p_session_id;

  v_will_remove_session :=
    v_bet_count = v_total_bet_count
    and v_share_count = v_total_share_count
    and v_warning_count = v_total_warning_count;

  if p_dry_run then
    return jsonb_build_object(
      'session_id', p_session_id,
      'bet_entries_count', v_bet_count,
      'share_history_count', v_share_count,
      'total_shared_amount', v_share_amount,
      'will_remove_session', v_will_remove_session,
      'session_deleted', false,
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

  -- session_targets cascades automatically via its warning_message_id FK.
  delete from public.warning_messages w
  where w.session_id = p_session_id
    and (v_is_master or w.created_by = v_caller_id);

  begin
    delete from public.sessions where id = p_session_id;
    v_session_deleted := true;
  exception when foreign_key_violation then
    -- Something outside this caller's scope (another admin's bet_entries,
    -- share_history, or warning_messages) still references the session —
    -- leave the row in place rather than failing the whole request; the
    -- caller's own data has already been cleared above.
    v_session_deleted := false;
  end;

  return jsonb_build_object(
    'session_id', p_session_id,
    'bet_entries_count', v_bet_count,
    'share_history_count', v_share_count,
    'total_shared_amount', v_share_amount,
    'will_remove_session', v_will_remove_session,
    'session_deleted', v_session_deleted,
    'dry_run', false
  );
end;
$$;

revoke all on function public.delete_session_history(uuid, boolean) from public;
grant execute on function public.delete_session_history(uuid, boolean) to authenticated;
