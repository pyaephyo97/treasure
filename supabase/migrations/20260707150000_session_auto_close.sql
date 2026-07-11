-- ============================================================================
-- Treasure — session auto-close countdown timer
-- ============================================================================
-- Admin sets auto_close_at (now() + N minutes); every client (Admin, User,
-- Partner) reads it and renders a live countdown so everyone knows how many
-- minutes are left before the session closes. Actual closing is driven
-- server-side by pg_cron (not the client) so it fires reliably even if no
-- browser is open when the timer expires.
-- ============================================================================

alter table public.sessions
  add column if not exists auto_close_at timestamptz;

create extension if not exists pg_cron with schema extensions;

create or replace function public.auto_close_expired_sessions()
returns void
language sql
security definer
set search_path = public
as $$
  update public.sessions
  set status = 'closed', closed_at = now()
  where status = 'open'
    and auto_close_at is not null
    and auto_close_at <= now();
$$;

-- Idempotent: cron.schedule() updates the existing job if the name matches.
select cron.schedule(
  'auto-close-treasure-sessions',
  '* * * * *',
  $$select public.auto_close_expired_sessions();$$
);
