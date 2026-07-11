-- Covering indexes for every foreign-key column flagged by the Supabase
-- performance advisor as unindexed. These are cheap at current row counts
-- but matter increasingly as bet_entries/entry_limits grow session over
-- session, and for admin-scoped joins (managed_by_current_admin lookups,
-- history pickers, over-limit record joins).
create index if not exists bet_entries_user_id_idx on public.bet_entries (user_id);
create index if not exists entry_limits_user_id_idx on public.entry_limits (user_id);
create index if not exists limit_table_profiles_created_by_idx on public.limit_table_profiles (created_by);
create index if not exists partner_over_limit_history_partner_id_idx on public.partner_over_limit_history (partner_id);
create index if not exists partner_over_limit_history_session_id_idx on public.partner_over_limit_history (session_id);
create index if not exists partner_over_limit_records_history_id_idx on public.partner_over_limit_records (history_id);
create index if not exists partner_over_limit_records_partner_id_idx on public.partner_over_limit_records (partner_id);
create index if not exists partner_over_limit_records_session_id_idx on public.partner_over_limit_records (session_id);
create index if not exists partner_shares_partner_id_idx on public.partner_shares (partner_id);
create index if not exists session_targets_account_id_idx on public.session_targets (account_id);
create index if not exists sessions_created_by_idx on public.sessions (created_by);
create index if not exists share_history_created_by_idx on public.share_history (created_by);
create index if not exists warning_messages_created_by_idx on public.warning_messages (created_by);
