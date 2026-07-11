-- ============================================================================
-- Treasure — enable Realtime (Postgres Changes) for the tables the client
-- subscribes to.
-- ============================================================================
-- The client has been calling supabase.channel(...).on('postgres_changes',
-- ...) against these tables since early in the project, but the
-- supabase_realtime publication had zero tables in it, so none of those
-- subscriptions were ever actually delivering events — every "live" update
-- (session status flips, warnings, bet entries, partner shares, and now
-- per-user data_entry_open toggles) silently depended on some OTHER
-- unrelated trigger (like the next full refreshAll()) to ever show up. This
-- is very likely the actual root cause behind "the button doesn't work" /
-- "that user still can't enter data" — the DB write succeeded, but nobody
-- else's browser was ever told about it.
-- ============================================================================

alter publication supabase_realtime add table
  public.accounts,
  public.sessions,
  public.warning_messages,
  public.bet_entries,
  public.partner_shares,
  public.share_history,
  public.over_limit_records;
