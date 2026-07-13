# Treasure — Project Spec & Maintenance Guide

Last updated: 2026-07-11, after a full codebase audit and performance pass. This document is the reference for anyone (including a future AI session) picking this project back up.

## What this is

Treasure is a 2D-lottery data-management platform with four roles: Master Admin, Admin, User, and Partner. Users submit bet entries against a running "session"; Admins configure per-number entry limits, set the winning number, and distribute over-limit amounts out to Partners; Partners receive shared data and can further redistribute anything over their own sub-limit. Everything is scoped to a "session" (roughly one lottery draw — sessions are labeled things like "12-07-2026 (AM)").

Stack: React 18 + Vite + TypeScript + Tailwind on the frontend, Supabase (Postgres + RLS + Auth + Edge Functions + Realtime) as the entire backend — there is no separate API server. Project root: `Design Treasure UI/`. Supabase project id: `onhqryreuutsubyfxowy`.

## Architecture: the one rule that matters

**Components never import `api.ts` directly.** Every piece of data and every mutation flows through `useApp()`, defined in `src/app/context.ts` (the `AppCtx` type) and implemented in `src/app/App.tsx` (the actual state + Supabase calls). `App.tsx` is the single source of truth: it holds all state, all realtime subscriptions, and exposes everything through `AppContext.Provider`. If you're adding a new capability, the flow is always: add the query/mutation to `api.ts` → add its shape to `AppCtx` in `context.ts` → wire a `useCallback` pass-through in `App.tsx` and add it to the provider's value object → consume it via `useApp()` in whatever component needs it. Skipping this and reaching into `api.ts` from a component breaks the pattern every other feature relies on.

The three role-based shells (`AdminLayout`, `UserLayout`, `PartnerLayout`) are lazy-loaded from `App.tsx` — only one ever renders per logged-in session, so there's no reason to ship all three to everyone. Inside `AdminLayout`, each of its 8 sub-pages (Dashboard, Accounts, Session, Entry Limits, Total Data, Winning Number, Reports, Profile) is also lazy-loaded, since only one is visible at a time.

## File map

```
src/app/
  App.tsx              root component — all state, all realtime subscriptions, auth bootstrap
  context.ts            AppCtx type + useApp() hook — the contract every component codes against
  types.ts               client-side (camelCase) types
  theme.ts               color tokens (C.*), used everywhere instead of a CSS framework's palette
  supabase/
    client.ts            Supabase client init (reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
    api.ts                every Supabase query, RPC call, and realtime subscription lives here
    mappers.ts            DB row (snake_case) <-> client type (camelCase) conversion
  utils/
    format.ts             "index = value" plain-text formatter (copy-to-clipboard convention)
    countdown.ts           useCountdownMs() hook, used for auto-close / entry-hold timers
  components/
    LoginScreen.tsx
    AdminLayout.tsx, UserLayout.tsx, PartnerLayout.tsx   — the three role shells
    admin/                8 admin-only pages (see above)
supabase/
  migrations/             every schema change, applied via Supabase MCP AND saved here — see below
  functions/               4 Edge Functions (see below)
docs/
  PROJECT_SPEC.md          this file
  MOBILE_APP_PLAN.md        step-by-step plan for the Users/Partners mobile app
```

## Data model

Core tables, all under RLS: `accounts` (all four roles, one table, `role` enum column), `sessions` (one row per lottery draw), `bet_entries` (User submissions, keyed by session+user+number), `entry_limits` (per-session, per-user, per-number cap — see the note below on why the UI treats this as one flat table), `partner_shares` (amounts pushed to Partners), `share_history` / `over_limit_records` (audit trail of each "distribute over limit" action), `partner_over_limit_history` / `partner_over_limit_records` (audit trail of each Partner "Send" action), `warning_messages` (+ `session_targets` for scoping, currently unused — see Known Gaps), `limit_table_profiles` / `limit_table_profile_rows` (reserved for saved-preset limit tables, currently unused — 0 rows, no UI wired to them yet).

Every session-scoped table is keyed by `session_id` and rows are never deleted when a new session opens — this is what makes the "select a past session by name" history pickers (User History tab, Partner Report tab, Admin Reports page) possible with zero data migration; the data was always there, the app just only ever queried the latest session until that feature was added.

**Important simplification to know about**: `entry_limits` is schema-wise one row per `(session_id, user_id, number)` — i.e. the database supports a different limit per individual User. The UI, however, deliberately treats it as **one flat 100-row table applied identically to every managed User** (`setLimitsDefault`/`setLimitRow`/`setLimitForDigit` in `api.ts` all fan the same value out to every user id passed in, and `App.tsx` always passes the full `users` list). Don't be surprised by the per-user schema — it's there, it's just not exposed as a per-user feature today. (An earlier "Assign to Users" per-user-subset control existed in the Entry Limits UI but was never wired to anything and has since been removed as dead code — see the audit note below.)

## RLS & the SECURITY DEFINER RPC pattern

Every table has RLS enabled. The general shape: rows are visible/editable based on `current_account_id()` (reads `auth.uid()`, SECURITY DEFINER) and `current_role()` / `is_admin_or_above()` / `is_master_admin()` / `managed_by_current_admin(id)` helper functions. The `accounts_update_managed` policy (`is_master_admin() OR created_by = current_account_id()`) means a manager can edit accounts they created, but **nobody can edit their own row directly** — Master Admin created Admins, Admins created Users/Partners, so no one "created themselves."

This is why every "let X edit their own Y" feature (Partner's own sub-limit, Admin's own commission/payout rate) is implemented as a narrow, single-purpose `SECURITY DEFINER` RPC (`set_my_sub_limit`, `set_my_admin_rates`) rather than a broadened RLS policy — a broadened policy would let a user edit *any* column on their own row, not just the one field that's supposed to be self-serviceable. Every RPC that matters (`calculate_pnl`, `distribute_over_limit`, `submit_bet_entries`, `set_my_*`, `send_partner_over_limit`) does its own internal `current_account_id()`/`current_role()`/ownership checks at the top of the function body — this was verified during the audit (see below). The Supabase security advisor flags all of these as "callable by anon/authenticated" because that's simply how `supabase.rpc()` works; the real authorization happens inside each function, not at the grant level.

## Realtime

Every table that needs live updates must be explicitly added to the `supabase_realtime` publication (`alter publication supabase_realtime add table ...`) — forgetting this was the root cause of a real bug earlier in this project's history, so it's now a checklist item: any new table with a realtime subscription must be added to the publication in the same migration that creates it.

`App.tsx` subscribes to: `sessions` (any field change), the logged-in user's own `accounts` row, and (once a session is active) `warning_messages`, `bet_entries`, `partner_over_limit_history`, and `partner_shares`, all scoped by `session_id`. As of the July 2026 performance pass, session and own-account pings no longer trigger a blanket `refreshAll()` — see below.

## Edge Functions

Four Edge Functions under `supabase/functions/`: `create-account` (account creation, including the Master-Admin-only ability to create Admin accounts), `validate-bet-entry`, `distribute-over-limit`, `calculate-pnl`. Most day-to-day mutations go through Postgres RPCs called directly via `supabase.rpc()` rather than Edge Functions — Edge Functions are reserved for logic that predates the RPC pattern or that benefited from being callable outside the RLS/RPC context.

## Conventions

**Migrations**: every schema change is applied live via the Supabase MCP `apply_migration` tool AND saved as a timestamped file under `supabase/migrations/` — both steps, every time, so the migrations directory always matches what's actually live.

**"index = value" plain text**: every copy-to-clipboard report/invoice feature uses the shared formatter in `utils/format.ts` (`formatIndexValueLines`) instead of ad hoc string building, so the output format stays consistent everywhere it appears (User invoice, Partner report, Admin reports, over-limit history).

**Payout detail format**: every "Payout" line in every P&L view (Admin/User/Partner, live and historical, card and plain-text) shows its work via the shared `formatPayoutDetail(winNum, heldAmount, payoutRate)` helper in `utils/format.ts`, rendering `"Win #46=500 × 3×"` — the winning number, the bet/share amount actually held on it, and the payout multiplier — appended in parens after the "Payout" label, e.g. `Payout (Win #46=500 × 3×): -1500`. A bare "Payout: -1500" with no breakdown was the old behavior and should not reappear in new P&L UI; `heldAmount` must be computed the same way `calculate_pnl` computes each role's payout basis (User: own bets on the winning number; Partner: own shares on the winning number; Admin: bets by managed users on the winning number minus whatever was already shared away to partners) so the displayed amount always multiplies out to the displayed payout total.

**Verification**: this project has no `tsconfig.json`, so there's no `tsc` type-check step, and `vite build` cannot currently run in this sandbox (missing native `@rollup/rollup-linux-arm64-gnu` binary with no registry access to fetch it — an environment limitation, not a code issue). The standard verification step after any change is a `@babel/parser` syntax check across every touched file (and periodically the whole `src/` tree). This catches syntax errors but **not** type errors — there is no substitute for actually testing a change in a real dev server (`npm run dev`) on a machine that can run the full toolchain before deploying anything user-facing.

## Data Entry modes (UserLayout.tsx)

Three entry modes, toggled at the top of the Data Entry tab: **Bulk Entry** (paste/type "index = value" lines, see the "index = value" convention above), **Keyboard Entry**, and **Single Entry** (one number + amount).

**Keyboard Entry** reproduces the layout and behavior of a reference screen recording (a 43-minute capture of an existing Myanmar 2D keyboard-entry UI), reverse-engineered frame-by-frame by tracing exact button-tap -> result-table pairs rather than guessing:

- Three header boxes — Number, Mode, Amount — plus a 4x5 numeric keypad (7/8/9/R, 4/5/6//, 1/2/3/ENTER, 0/00/000/OK) and a row of 7 pattern-mode tabs, matching the recording's positions exactly.
- **Straight** (default, no tab selected): type a 1-2 digit number (or several separated by `/`, e.g. `12/34/56`), set an amount, ENTER adds it to the pending list. Amount stays sticky after ENTER (matches the recording); Number and Mode reset.
- **R key**: type a 2-digit number, tap R — adds both the number and its digit-reversed counterpart at the same amount (one entry at double amount if it's a palindrome like 55), identical to Bulk Entry's `46R1000` convention.
- **Head** / **Tail** / **Break** tabs: type a single digit 0-9. Head generates the 10 numbers `D0..D9`; Tail generates `0D..9D`; Break generates the 10 numbers whose digits sum to `D` mod 10 (e.g. Break "5" -> 05,14,23,32,41,50,69,78,87,96). All three were verified against the recording by matching the exact numbers it produced for a given input digit — this is server-verifiable arithmetic, not a guess.
- ENTER commits to a pending list (editable, per-row delete); OK (or the bottom "Submit" button) opens a confirm dialog stating the count and total before calling `submitBetEntries` — same confirm-then-submit pattern as Bulk Entry, and same recovery behavior (server-rejected rows stay in the list to fix and resubmit).
- **Power, Twin, Ko, Twin-Ko tabs, and the Nekkhat/Kwe/Apar quick buttons** are rendered in the same layout position as the recording (so the screen looks the same) but are **disabled with a "coming soon" message** — their exact generation rule could not be confirmed from the recording alone. Power in particular looks like a curated/external "hot numbers" list rather than something derivable from button-tap patterns. Fabricating a plausible-looking but wrong rule for a money-handling feature was judged worse than shipping it disabled; get the exact rule from whoever maintains the reference app and wire it into `computeKbEntries` in `UserLayout.tsx` the same way Head/Tail/Break are implemented.

## Known gaps / accepted limitations (not bugs, just worth knowing)

- Keyboard Entry's Power/Twin/Ko/Twin-Ko tabs and its Nekkhat/Kwe/Apar quick buttons are UI-only placeholders (see "Data Entry modes" above) — tapping them shows a toast, they don't generate numbers. This is the single biggest known gap in the entry-mode feature set.
- P&L and commission calculations always use an account's **current** `commission_rate`/`payout_rate`, applied retroactively even when viewing a historical session's P&L. There is no historical rate snapshotting anywhere in the system. If a User's commission rate changes today, re-opening last week's session report will show P&L computed at today's rate, not the rate that was in effect back then. Consistent across every P&L path (live and historical) — a deliberate scope decision, not an oversight.
- `warning_messages.audience_scope = 'selected'` and the `session_targets` table exist in the schema for targeting specific accounts with a warning, but no UI currently sets `audience_scope` to anything other than `'all'` — `session_targets` has 0 rows. Reserved for a future "target specific users/partners" feature.
- `limit_table_profiles` / `limit_table_profile_rows` (saved limit-table presets) exist in the schema with 0 rows and no UI. Reserved, unused.
- Countdown timers (`useCountdownMs`, used for auto-close and entry-hold banners) each run their own independent `setInterval`. A screen showing both timers runs two separate per-second re-render ticks instead of one shared one. Left as-is — low actual cost, and consolidating risked introducing timing bugs in logic that's already been tuned correctly across several rounds of fixes.

## July 2026 audit & performance pass — what changed

A full codebase + database audit was run (general-purpose research agent for the frontend, Supabase advisors for the database). Findings and fixes:

**Database**: added 13 missing indexes on foreign-key columns across `bet_entries`, `entry_limits`, `limit_table_profiles`, `partner_over_limit_history`, `partner_over_limit_records`, `partner_shares`, `session_targets`, `sessions`, and `share_history`/`warning_messages` (migration `20260711200010_perf_missing_fk_indexes.sql`). The two "unused index" advisor hits (`over_limit_records_share_history_idx`, `partner_shares_share_history_idx`) were left in place — at current row counts the planner just prefers seq scans on small tables, which doesn't mean the index is wrong at production scale. Confirmed via `pg_get_functiondef` that every SECURITY DEFINER RPC does real internal authorization (not just relying on RLS/grants) — no changes needed there. The one real, unresolved security item: **leaked-password protection is disabled** in Supabase Auth — this is a Dashboard toggle (Authentication → Policies → Password Security), not something fixable via migration; recommended to turn on.

**Realtime over-fetching (the biggest win)**: `App.tsx`'s `subscribeToSession` and `subscribeToMyAccount` handlers used to call a full `refreshAll()` (11 Supabase queries) on *any* change to the session row or the logged-in user's own account row — including single-field changes like the winning number or an auto-close timer tick. Now: a session ping does a cheap single-row `fetchLatestSession()` and only escalates to a full `refreshAll()` if the session `id` itself changed (i.e. a genuinely new session opened); an own-account ping only refetches that account's own row plus the one role-list it belongs to, via a new `refreshMyAccountOnly()`.

**Race conditions**: `refreshAll()` and `refreshAdminPnl()` now use a generation-counter guard — if a second call starts before the first resolves, the first's (now-stale) result is discarded instead of possibly overwriting newer state. `refreshAll()`'s three independent initial queries (`fetchLatestSession`, `getMyAccount`, `fetchAllSessions`) were also merged into the existing `Promise.all` batch, cutting the call from ~4 sequential round-trips to 2.

**Duplicate P&L recalculation**: `confirmDistributionAction` and the `subscribeToPartnerShares` realtime handler both used to call `refreshAdminPnl()` explicitly *and* trigger it a second time via the reactive `useEffect` keyed on `partnerShares` — the explicit calls were removed since the reactive effect already covers it.

**Bundle size / code splitting**: `AdminLayout`, `UserLayout`, and `PartnerLayout` are now `React.lazy`-loaded from `App.tsx` (previously all three, plus every admin sub-page, shipped to every role regardless of whether they'd ever be rendered). The 8 admin sub-pages are similarly lazy-loaded within `AdminLayout`. This matters more, not less, once the mobile PWA exists — a User on a phone now only downloads `UserLayout`'s code, not the entire Admin panel.

**Correctness bugs fixed**: `Dashboard.tsx` and `AdminReports.tsx` both had a hardcoded `5000` over-limit threshold instead of reading the actual persisted `session.totalDataSetLimit` configured on the Total Data page — both now use the real value (falling back to 5,000 only if never set). The Entry Limits page had a non-functional "Assign to Users" button/modal that showed a success toast without calling any API — since the app's data model deliberately treats the limit table as one flat table for every managed User (see above), this control fundamentally contradicted the app's own architecture rather than being a small wiring gap, so it was removed rather than built out.

**Smaller fixes**: memoized a few previously-unmemoized array computations in `Dashboard.tsx` (`totalAmount`, `totalShared`, `recentEntries`) that run on every render over potentially large `betEntries` arrays; hoisted a couple of per-render-recreated style helpers/arrays (`UserLayout.tsx`'s `TABS`, `AccountManagement.tsx`'s `btn()`) to module scope; capped `fetchAllSessions()` at 200 rows so the session-history payload doesn't grow unbounded forever; removed dead code (`uiRoleToDbRole` in `mappers.ts`, `numbersContainingDigit`'s unnecessary export in `api.ts`, and an entirely unused `src/imports/TreasureFlowchart.tsx` Figma import artifact).

## Extending this project

Adding a new feature that needs its own data almost always touches the same five places, in this order: (1) a migration under `supabase/migrations/`, applied live via MCP and saved; (2) a new function in `api.ts`; (3) a new field/method on `AppCtx` in `context.ts`; (4) state + a `useCallback` pass-through in `App.tsx`, added to the provider value; (5) the actual UI in whatever component consumes `useApp()`. If the new table needs live updates, don't forget the `alter publication supabase_realtime add table ...` line in the same migration. If a user needs to self-service-edit one specific field on their own account row, reach for a narrow `SECURITY DEFINER` RPC (see `set_my_sub_limit`/`set_my_admin_rates` for the pattern) rather than broadening RLS.

See `docs/MOBILE_APP_PLAN.md` for the plan to bring Users and Partners onto a mobile PWA — it's designed to reuse this entire data layer (`api.ts`/`context.ts`/`types.ts`) unchanged, which is exactly why the conventions in this document matter for that work specifically.
