# Mobile App for Users & Partners — Step-by-Step Plan

## Recommendation: build it as a PWA, not a native app (for now)

A Progressive Web App (installable via "Add to Home Screen") is the right first move here, for three concrete reasons specific to this project:

1. **App-store risk.** Apple and Google both restrict real-money lottery/betting apps from public store listings unless the developer holds specific gambling licensing and implements geofencing and age verification per jurisdiction. This is a 2D-lottery betting system, so a public App Store/Play Store submission is likely to get rejected or held for compliance review. A PWA has no store gatekeeper at all — you deploy it to a URL and people install it straight from the browser.
2. **Near-total code reuse.** The entire data layer this project already has — `api.ts`, `context.ts`, `types.ts`, `mappers.ts`, RLS policies, Realtime publication, Edge Functions — is UI-framework-agnostic. Users and Partners already have working logic for bet entry, session history, receiving shares, sub-limits, and reports (`UserLayout.tsx`, `PartnerLayout.tsx`). The mobile app only needs new, phone-sized *screens* wrapped around logic that already exists and already works.
3. **Speed.** No app-store review queue, no separate iOS/Android build pipeline to maintain, one deploy reaches everyone instantly.

Trade-off to know about: iOS Web Push only works once the PWA has been added to the home screen (not from a plain Safari tab), and iOS trails Android slightly in PWA feature support. If you later want real app-store presence for marketing/credibility reasons, React Native (Expo) is the natural next step — the Supabase data layer ports over with minimal change since it's plain JS/TS calls, not React-DOM-specific.

---

## Phase 0 — Decide the shape of the app

Admins keep using the existing desktop web app, completely unchanged. Users and Partners get the new mobile PWA. Recommended structure: keep it inside the **same** `Design Treasure UI` project rather than a separate repo, so the shared data layer is imported once and can't drift out of sync between web and mobile. The mobile build simply never imports anything from `src/app/components/admin/*` or the desktop `AdminLayout`/`UserLayout`/`PartnerLayout` shells — it gets its own lightweight layouts.

## Phase 1 — Set up the PWA project

- Add `vite-plugin-pwa` to the existing Vite config (`vite.config.ts` already has `react()` and `tailwindcss()` plugins — this slots in alongside them).
- Create `manifest.json`: app name ("Treasure"), theme color, standalone display mode, and icon set (192×192, 512×512, plus a maskable icon for Android).
- Register a service worker for offline app-shell caching (so the UI loads instantly even on a flaky connection — actual data still needs the network, but the interface itself won't be a blank white screen).
- Add a mobile-optimized entry route so the same deployed URL can serve the existing desktop experience to Admins and a phone-shaped shell to Users/Partners.

## Phase 2 — User (bet entry) mobile screens

Rebuild the bet-entry flow as a single-column, thumb-friendly layout: large number pad, quick amount entry, running total, one-tap submit, a session-status banner (open/closed/held), and the session history picker. The History tab logic already built in `UserLayout.tsx` (session dropdown → `fetchSessionBetEntries` / `fetchSessionPnl`) can be lifted almost as-is — it's already just data fetching, only the surrounding JSX needs a phone-sized redesign.

## Phase 3 — Partner (receive data) mobile screens

Rebuild the receiving flow: a live-updating "Received Numbers" list, Within-Limit vs Over-Limit views, the Send button, the sub-limit setting, and the Report tab with its session picker. Nothing new is needed on the backend for this — `partner_shares`, `partner_over_limit_history`, and `partner_over_limit_records` are already in the `supabase_realtime` publication, so a Partner opening the mobile app gets live pushes the instant an Admin shares numbers, same as the web app does today.

## Phase 4 — Auth & session persistence

Reuse the existing Supabase Auth (username/password) login flow as-is. `supabase-js` persists the session token locally by default, so once a User or Partner logs in on their phone they stay logged in across app opens — no extra work required here beyond building the mobile login screen itself.

## Phase 5 — Push notifications (optional, high value)

Wire up Web Push so Partners get notified the moment new numbers are shared, and Users get notified when a session opens/closes or a warning goes out — piggybacking on the same Postgres Realtime events already flowing today. This needs one small new piece server-side (an Edge Function or a Postgres trigger that fans out to a push service); it doesn't touch any existing tables or RLS policies.

## Phase 6 — Test and ship

Test "Add to Home Screen" on a real Android phone and a real iPhone, confirm the offline app shell loads, and confirm Realtime reconnects properly when the app is backgrounded and reopened. Deploy to the same hosting used today; share the install URL as a link or QR code — Users and Partners can be up and running in under a minute, with no store submission and no review wait.

## Phase 7 — Later, optional: graduate to React Native

If app-store presence ever becomes a priority (marketing, discoverability, deeper native features like camera or contacts), the same `api.ts` / `types.ts` / `context.ts` logic ports into a React Native (Expo) app with minimal change, since none of it is tied to the browser DOM. This is a "when you need it" step, not a blocker to shipping the PWA now.
