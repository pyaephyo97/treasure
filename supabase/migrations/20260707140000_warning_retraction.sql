-- ============================================================================
-- Treasure — small addendum: allow Admin to retract a sent warning message
-- ============================================================================
-- The original schema treated warning_messages as an append-only log (no
-- UPDATE/DELETE policy), matching "immutable audit log" for compliance
-- history. But the actual UI (SessionControl.tsx) has a "remove warning"
-- button that's meant to stop showing an active warning to Users/Partners —
-- that's a legitimate admin action, not a data-integrity violation. Rather
-- than a hard DELETE (which would lose the historical record), this adds a
-- soft is_active flag: retracting sets is_active = false, which the SELECT
-- policy already needs to respect for non-admin viewers.
-- ============================================================================

alter table public.warning_messages
  add column is_active boolean not null default true;

drop policy if exists warning_messages_select on public.warning_messages;

create policy warning_messages_select on public.warning_messages
  for select to authenticated
  using (
    public.is_admin_or_above()
    or (
      is_active
      and audience_role::text = public.current_role()::text
      and (
        audience_scope = 'all'
        or exists (
          select 1 from public.session_targets st
          where st.warning_message_id = warning_messages.id
            and st.account_id = public.current_account_id()
        )
      )
    )
  );

-- Admin/master_admin can retract (is_active -> false) a warning they sent.
-- No other field is editable — message/audience/created_by stay immutable.
create policy warning_messages_update_retract on public.warning_messages
  for update to authenticated
  using (public.is_admin_or_above() and created_by = public.current_account_id())
  with check (public.is_admin_or_above() and created_by = public.current_account_id());
