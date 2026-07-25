import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { Toaster } from 'sonner';
import { AppContext, type AccountTab } from './context';
import type {
  Role, Session, UserAccount, PartnerAccount, AdminAccount, BetEntry, LimitRow, PartnerShare, WarningMessage,
  AdminPnl, ShareMethod, ShareHistoryEntry, PartnerOverLimitEntry,
} from './types';
import { LoginScreen } from './components/LoginScreen';
import { supabase, isSupabaseConfigured } from './supabase/client';
import * as api from './supabase/api';
import { dbRoleToUiRole } from './supabase/mappers';
import { C } from './theme';

// Code-split by role: only one of these three ever renders per session, so
// there's no reason for e.g. a User's phone/browser to download the entire
// Admin panel (8 sub-pages) or the Partner panel's bundle weight.
const AdminLayout = lazy(() => import('./components/AdminLayout').then(m => ({ default: m.AdminLayout })));
const UserLayout = lazy(() => import('./components/UserLayout').then(m => ({ default: m.UserLayout })));
const PartnerLayout = lazy(() => import('./components/PartnerLayout').then(m => ({ default: m.PartnerLayout })));

function RouteFallback() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center" style={{ background: C.bg, color: C.text }}>
      <p style={{ color: C.textMuted, fontSize: 14 }}>Loading…</p>
    </div>
  );
}

const EMPTY_SESSION: Session = {
  id: '',
  label: 'No Session',
  status: 'closed',
  openedAt: new Date(0).toISOString(),
  winningNumber: null,
  shareMethod: 'percentage',
  autoCloseAt: null,
  totalDataSetLimit: null,
  entryHoldUntil: null,
};

function emptyLimitTable(): LimitRow[] {
  return Array.from({ length: 100 }, (_, i) => ({ number: String(i).padStart(2, '0'), limit: 0 }));
}

// --- Resume cache ---------------------------------------------------------
// Home-screen PWAs on iOS/Android are far more aggressive about killing a
// backgrounded web app's process than the OS is about suspending a native
// app — reopening the icon after even a short time away is frequently a
// full cold restart of the JS runtime, not a resume. There is no way for a
// web app to prevent the OS from doing this (a real platform limitation,
// not a bug in this codebase); the only thing under our control is what
// shows up during that cold restart. Without this cache, every reopen blanks
// to a "Loading Treasure…" screen for as long as the auth+data bootstrap
// takes. With it, the last known role/session/profile is restored
// synchronously on the very first render, so the real layout appears
// immediately (using that slightly-stale snapshot) instead of a blank
// screen, while the normal background bootstrap+refreshAll() quietly
// catches everything up to current within a moment — the same "show the
// last frame instantly, refresh underneath it" trick native apps get for
// free from OS-level process suspension.
const RESUME_CACHE_KEY = 'treasure_resume_v1';

type ResumeCache = {
  role: Role;
  currentUserId: string;
  session: Session;
  myProfile: { username: string; commissionRate: number; payoutRate: number } | null;
};

function readResumeCache(): ResumeCache | null {
  try {
    const raw = localStorage.getItem(RESUME_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.role !== 'string' || typeof parsed.currentUserId !== 'string') return null;
    return parsed as ResumeCache;
  } catch {
    return null;
  }
}

function writeResumeCache(cache: ResumeCache) {
  try {
    localStorage.setItem(RESUME_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Storage full/blocked — this is a perceived-speed optimization only,
    // never a correctness requirement, so fail silently.
  }
}

function clearResumeCache() {
  try {
    localStorage.removeItem(RESUME_CACHE_KEY);
  } catch {
    // Non-fatal.
  }
}

export default function App() {
  // `loading` only starts true when there's truly nothing to resume from
  // (first-ever visit, or the cache was cleared) — every other state below
  // is optimistically seeded from the resume cache too, so a warm reopen
  // renders the real layout on the very first frame instead of a blank
  // "Loading Treasure…" screen. The bootstrap effect further down still
  // runs in the background either way, to confirm the session is actually
  // still valid and refresh every list to current.
  const [loading, setLoading] = useState(() => readResumeCache() === null);
  const [role, setRole] = useState<Role>(() => readResumeCache()?.role ?? 'login');
  const [currentUserId, setCurrentUserId] = useState(() => readResumeCache()?.currentUserId ?? '');

  const [session, setSessionState] = useState<Session>(() => readResumeCache()?.session ?? EMPTY_SESSION);
  const [users, setUsersState] = useState<UserAccount[]>([]);
  const [partners, setPartnersState] = useState<PartnerAccount[]>([]);
  const [admins, setAdminsState] = useState<AdminAccount[]>([]);
  const [betEntries, setBetEntriesState] = useState<BetEntry[]>([]);
  const [limitTable, setLimitTableState] = useState<LimitRow[]>(emptyLimitTable());
  const [partnerShares, setPartnerSharesState] = useState<PartnerShare[]>([]);
  const [shareHistory, setShareHistoryState] = useState<ShareHistoryEntry[]>([]);
  const [partnerOverLimitHistory, setPartnerOverLimitHistoryState] = useState<PartnerOverLimitEntry[]>([]);
  const [warnings, setWarningsState] = useState<WarningMessage[]>([]);
  const [adminPnl, setAdminPnl] = useState<AdminPnl | null>(null);
  const [myProfile, setMyProfile] = useState<{ username: string; commissionRate: number; payoutRate: number } | null>(() => readResumeCache()?.myProfile ?? null);
  const [allSessions, setAllSessionsState] = useState<Session[]>([]);

  // Keeps the resume cache current so the *next* cold restart has a fresh
  // snapshot to optimistically render from. Cleared the moment we're back
  // at the login state, so a signed-out device never has a stale identity
  // lying around to flash on its next open.
  useEffect(() => {
    if (role === 'login' || !currentUserId) {
      clearResumeCache();
      return;
    }
    writeResumeCache({ role, currentUserId, session, myProfile });
  }, [role, currentUserId, session, myProfile]);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const roleRef = useRef(role);
  roleRef.current = role;

  // Generation counters so that if two refreshAll()/refreshAdminPnl() calls
  // overlap (e.g. two realtime pings arrive close together), a slower
  // earlier response can never clobber a faster newer one — the response is
  // simply dropped if a newer call has since started.
  const refreshRequestIdRef = useRef(0);
  const pnlRequestIdRef = useRef(0);

  const refreshAll = useCallback(async () => {
    const requestId = ++refreshRequestIdRef.current;

    // None of these six queries depend on each other's result, so they run
    // as a single parallel batch instead of several sequential round-trips.
    const [sess, account, allSess, u, p, a] = await Promise.all([
      api.fetchLatestSession(),
      // getMyAccount() reads the live Supabase auth session directly (not
      // any component state), so it's safe to call unconditionally here —
      // this is what keeps Admin's own Profile page (username/commission/
      // payout) in sync after login and after any realtime ping to this
      // account's own row.
      api.getMyAccount(),
      api.fetchAllSessions(),
      api.fetchManagedUsers(),
      api.fetchManagedPartners(),
      api.fetchManagedAdmins(),
    ]);
    if (requestId !== refreshRequestIdRef.current) return; // superseded by a newer refresh

    const activeSession = sess ?? EMPTY_SESSION;
    setSessionState(activeSession);
    setMyProfile(account ? { username: account.username, commissionRate: account.commissionRate, payoutRate: account.payoutRate } : null);
    setAllSessionsState(allSess);
    setUsersState(u);
    setPartnersState(p);
    setAdminsState(a);

    if (activeSession.id) {
      const [entries, limits, shares, warns, history, partnerOverLimit] = await Promise.all([
        api.fetchBetEntries(activeSession.id),
        api.fetchLimitTable(activeSession.id),
        api.fetchPartnerShares(activeSession.id),
        api.fetchWarnings(activeSession.id),
        api.fetchShareHistory(activeSession.id),
        api.fetchPartnerOverLimitHistory(activeSession.id),
      ]);
      if (requestId !== refreshRequestIdRef.current) return;
      setBetEntriesState(entries);
      setLimitTableState(limits);
      setPartnerSharesState(shares);
      setWarningsState(warns);
      setShareHistoryState(history);
      setPartnerOverLimitHistoryState(partnerOverLimit);
    } else {
      setBetEntriesState([]);
      setLimitTableState(emptyLimitTable());
      setPartnerSharesState([]);
      setWarningsState([]);
      setShareHistoryState([]);
      setPartnerOverLimitHistoryState([]);
    }
  }, []);

  const refreshAdminPnl = useCallback(async () => {
    if (!sessionRef.current.id || (roleRef.current !== 'admin' && roleRef.current !== 'masterAdmin')) {
      setAdminPnl(null);
      return;
    }
    const requestId = ++pnlRequestIdRef.current;
    const { pnl } = await api.calculatePnl(sessionRef.current.id);
    if (requestId !== pnlRequestIdRef.current) return; // superseded by a newer P&L request
    setAdminPnl(pnl ?? null);
  }, []);

  // Targeted refetch for a ping on this user's OWN account row (e.g. an
  // admin flipping this user's data-entry toggle, is_active, or rates) —
  // only refetches this account's own data + the one role-list it belongs
  // to, instead of the full refreshAll() fan-out (session, all sessions,
  // all three managed-account lists, and every session-scoped table).
  const refreshMyAccountOnly = useCallback(async () => {
    const [account] = await Promise.all([
      api.getMyAccount(),
      roleRef.current === 'user' ? api.fetchManagedUsers().then(setUsersState)
        : roleRef.current === 'partner' ? api.fetchManagedPartners().then(setPartnersState)
        : (roleRef.current === 'admin' || roleRef.current === 'masterAdmin') ? api.fetchManagedAdmins().then(setAdminsState)
        : Promise.resolve(),
    ]);
    setMyProfile(account ? { username: account.username, commissionRate: account.commissionRate, payoutRate: account.payoutRate } : null);
  }, []);

  // --- resilient "is there still a valid session" check ---
  // Android/PWA note: backgrounding this app (switching apps, locking the
  // screen, or even just leaving the browser tab for a while) frequently
  // gets the whole page torn down and reloaded from scratch when the user
  // comes back — a real OS memory-pressure behavior on Android, not
  // something a web app can prevent (see the resume-cache comment above).
  // The very first thing a fresh reload does is ask Supabase "is there
  // still a session?" via getSession(). That call can fail transiently
  // right at that exact moment — the JS engine is often resumed a beat
  // before the OS network stack has finished reconnecting — and the old
  // code here treated ANY session-less response (including a network
  // error) as definitive proof the user had been signed out, wiping the
  // resume cache and forcing back to the login screen even though the
  // refresh token on disk was still perfectly valid. That's what was
  // reported as "account signs out automatically" after backgrounding.
  //
  // recheckAuthSession() only treats a session-less response as a REAL
  // logout when Supabase reports no error alongside it. A network/transient
  // error instead gets a few retries with backoff; if it's still
  // unresolved after those, whatever's already on screen (the
  // optimistically-restored resume-cache state, if any) is left alone
  // rather than forcing a sign-out purely because of a momentary
  // connectivity gap — the account stays signed in, and this same check
  // fires again on the next visibility/online event to quietly resolve
  // itself once the connection is back.
  const recheckAuthSession = useCallback(async (attempt = 0): Promise<void> => {
    async function bootstrapForAuthUser() {
      const account = await api.getMyAccount();
      if (!account) {
        // Authenticated with Supabase Auth but no matching accounts row —
        // treat as logged out instead of rendering a broken layout.
        await supabase.auth.signOut();
        setRole('login');
        setCurrentUserId('');
        clearResumeCache();
        setLoading(false);
        return;
      }
      setCurrentUserId(account.id);
      setRole(dbRoleToUiRole(account.role));
      await refreshAll();
      setLoading(false);
    }

    const { data, error } = await supabase.auth.getSession();

    if (data.session) {
      await bootstrapForAuthUser();
      return;
    }

    if (error) {
      if (attempt < 3) {
        setTimeout(() => { recheckAuthSession(attempt + 1); }, 600 * Math.pow(2, attempt));
      } else {
        setLoading(false);
      }
      return;
    }

    // No error AND no session — Supabase has authoritatively confirmed
    // there's nothing to resume. This is the only path allowed to force
    // the login screen / clear the resume cache.
    setRole('login');
    setCurrentUserId('');
    setSessionState(EMPTY_SESSION);
    setMyProfile(null);
    clearResumeCache();
    setLoading(false);
  }, [refreshAll]);

  // --- bootstrap auth + subscribe to auth state changes ---
  useEffect(() => {
    recheckAuthSession();

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'SIGNED_IN' && newSession) {
        // No blocking full-screen loader here: an interactive login already
        // gets its own "SIGNING IN…" state from LoginScreen's submit button,
        // and a resumed session already has role/session/myProfile restored
        // synchronously from the resume cache above — recheckAuthSession()
        // just quietly confirms and refreshes everything in the background
        // either way. Setting `loading` true here was a redundant extra
        // blank-screen flash on top of both of those.
        recheckAuthSession();
      } else if (event === 'SIGNED_OUT') {
        setRole('login');
        setCurrentUserId('');
        setSessionState(EMPTY_SESSION);
        setUsersState([]);
        setPartnersState([]);
        setAdminsState([]);
        setBetEntriesState([]);
        setLimitTableState(emptyLimitTable());
        setPartnerSharesState([]);
        setShareHistoryState([]);
        setPartnerOverLimitHistoryState([]);
        setWarningsState([]);
        setAdminPnl(null);
        setMyProfile(null);
        setAllSessionsState([]);
        clearResumeCache();
      }
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, [recheckAuthSession]);

  // Proactively re-verifies the session when the app regains focus or
  // network connectivity, instead of waiting for the next API call to fail.
  // This covers the case where the JS process survived backgrounding (so
  // this is a genuine visibility change rather than the full cold restart
  // recheckAuthSession's own retry logic above already handles) but its
  // token refresh got skipped or throttled while the tab was hidden.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') recheckAuthSession(); };
    const onOnline = () => recheckAuthSession();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [recheckAuthSession]);

  // --- realtime subscriptions ---
  useEffect(() => {
    if (role === 'login') return;
    const unsubs: (() => void)[] = [api.subscribeToSession(async () => {
      // Most session pings are a single-field change on the SAME session
      // (winning number, hold, auto-close timer, total-data limit, share
      // method) — those only need a cheap one-row patch. A full refreshAll()
      // (11 queries) is only actually needed when the session id itself
      // changes, i.e. a new session was opened and every session-scoped
      // table (bet entries, limits, shares...) needs to reset.
      const sess = await api.fetchLatestSession();
      const activeSession = sess ?? EMPTY_SESSION;
      if (activeSession.id !== sessionRef.current.id) {
        await refreshAll();
      } else {
        setSessionState(activeSession);
      }
    })];

    // Own-account changes (e.g. an Admin flipping this user's data-entry
    // Open/Closed toggle, or is_active/commission/payout edits) need to
    // reach this tab live — otherwise whoever's logged in stays stuck on
    // whatever state was fetched at login until they manually reload. Only
    // this account's own row + role-list are refetched, not everything.
    if (currentUserId) {
      unsubs.push(api.subscribeToMyAccount(currentUserId, () => { refreshMyAccountOnly(); }));
    }

    if (session.id) {
      const sid = session.id;
      unsubs.push(api.subscribeToWarnings(sid, () => { api.fetchWarnings(sid).then(setWarningsState); }));
      unsubs.push(api.subscribeToBetEntries(sid, () => { api.fetchBetEntries(sid).then(setBetEntriesState); }));
      unsubs.push(api.subscribeToPartnerOverLimitHistory(sid, () => {
        api.fetchPartnerOverLimitHistory(sid).then(setPartnerOverLimitHistoryState);
      }));
      // No explicit refreshAdminPnl() call here — updating partnerShares
      // already triggers the reactive P&L effect below (keyed on
      // partnerShares), so calling it here too would just double the
      // calculate-pnl edge-function invocation for the same event.
      unsubs.push(api.subscribeToPartnerShares(sid, () => {
        api.fetchPartnerShares(sid).then(setPartnerSharesState);
      }));
    }

    return () => { unsubs.forEach(u => u()); };
  }, [role, session.id, currentUserId, refreshAll, refreshMyAccountOnly]);

  // recompute admin P&L whenever the winning number or underlying totals change
  useEffect(() => {
    refreshAdminPnl();
  }, [session.winningNumber, betEntries, partnerShares, refreshAdminPnl]);

  // Auto-close fallback: the pg_cron job (auto_close_expired_sessions) is
  // the authoritative closer and runs every minute regardless of whether
  // anyone has the app open. This effect just gives Admin/Master Admin a
  // near-instant close instead of waiting up to ~60s for the next cron
  // tick, when they happen to have the app open at the moment it expires.
  const autoCloseFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (role !== 'admin' && role !== 'masterAdmin') return;
    if (session.status !== 'open' || !session.autoCloseAt) return;
    const target = new Date(session.autoCloseAt).getTime();

    const tryClose = () => {
      if (Date.now() < target) return;
      if (autoCloseFiredRef.current === session.id) return;
      autoCloseFiredRef.current = session.id;
      api.closeSession(session.id).then(({ error }) => {
        if (!error) setSessionState(s => (s.id === session.id ? { ...s, status: 'closed', closedAt: new Date().toISOString() } : s));
      });
    };

    tryClose();
    const id = setInterval(tryClose, 1000);
    return () => clearInterval(id);
  }, [role, session.status, session.autoCloseAt, session.id]);

  // --- auth actions ---
  const login = useCallback(async (u: string, p: string) => api.login(u, p), []);
  const logout = useCallback(async () => { await api.logout(); }, []);

  // --- account actions ---
  // Master Admin is a superuser and may pass role: 'admin' here too (regular
  // Admins are blocked from that server-side, in the create-account edge
  // function — the UI just never offers it to them).
  const createAccount = useCallback(async (payload: {
    role: 'user' | 'partner' | 'admin'; username: string; password: string;
    commissionRate: number; payoutRate: number; sharePercentage?: number;
  }) => {
    const { error } = await api.createAccount({
      role: payload.role,
      username: payload.username,
      password: payload.password,
      commissionRate: payload.commissionRate,
      payoutRate: payload.payoutRate,
      dataSharePercentage: payload.sharePercentage,
    });
    if (!error) {
      if (payload.role === 'user') setUsersState(await api.fetchManagedUsers());
      else if (payload.role === 'partner') setPartnersState(await api.fetchManagedPartners());
      else setAdminsState(await api.fetchManagedAdmins());
    }
    return { error };
  }, []);

  const updateAccount = useCallback(async (
    id: string,
    tab: AccountTab,
    patch: { username?: string; commissionRate?: number; payoutRate?: number; sharePercentage?: number }
  ) => {
    const { error } = await api.updateAccount(id, patch);
    if (!error) {
      if (tab === 'users') setUsersState(await api.fetchManagedUsers());
      else if (tab === 'partners') setPartnersState(await api.fetchManagedPartners());
      else setAdminsState(await api.fetchManagedAdmins());
    }
    return { error };
  }, []);

  const toggleAccountActive = useCallback(async (id: string, tab: AccountTab) => {
    const current = tab === 'users' ? users.find(u => u.id === id)
      : tab === 'partners' ? partners.find(p => p.id === id)
      : admins.find(a => a.id === id);
    if (!current) return { error: 'Account not found' };
    const { error } = await api.setAccountActive(id, !current.isActive);
    if (!error) {
      if (tab === 'users') setUsersState(await api.fetchManagedUsers());
      else if (tab === 'partners') setPartnersState(await api.fetchManagedPartners());
      else setAdminsState(await api.fetchManagedAdmins());
    }
    return { error };
  }, [users, partners, admins]);

  const deactivateAccount = useCallback(async (id: string, tab: AccountTab) => {
    const { error } = await api.setAccountActive(id, false);
    if (!error) {
      if (tab === 'users') setUsersState(await api.fetchManagedUsers());
      else if (tab === 'partners') setPartnersState(await api.fetchManagedPartners());
      else setAdminsState(await api.fetchManagedAdmins());
    }
    return { error };
  }, []);

  const toggleUserDataEntry = useCallback(async (id: string) => {
    const current = users.find(u => u.id === id);
    if (!current) return { error: 'Account not found' };
    const { error } = await api.setUserDataEntryOpen(id, !current.dataEntryOpen);
    if (!error) setUsersState(await api.fetchManagedUsers());
    return { error };
  }, [users]);

  // --- session actions ---
  const openSessionAction = useCallback(async () => {
    const { session: newSession, error } = await api.openSession(currentUserId);
    if (!error && newSession) {
      setSessionState(newSession);
      await refreshAll();
    }
    return { error };
  }, [currentUserId, refreshAll]);

  const closeSessionAction = useCallback(async () => {
    if (!session.id) return { error: 'No active session' };
    const { error } = await api.closeSession(session.id);
    if (!error) setSessionState(s => ({ ...s, status: 'closed', closedAt: new Date().toISOString() }));
    return { error };
  }, [session.id]);

  const setWinningNumberAction = useCallback(async (number: string) => {
    if (!session.id) return { error: 'No active session' };
    const { error } = await api.setWinningNumber(session.id, number);
    if (!error) setSessionState(s => ({ ...s, winningNumber: number }));
    return { error };
  }, [session.id]);

  const setAutoCloseTimerAction = useCallback(async (minutes: number) => {
    if (!session.id) return { error: 'No active session' };
    if (!Number.isFinite(minutes) || minutes <= 0) return { error: 'Enter a number of minutes greater than 0' };
    const { error } = await api.setAutoCloseTimer(session.id, minutes);
    if (!error) {
      const target = new Date(Date.now() + minutes * 60_000).toISOString();
      setSessionState(s => ({ ...s, autoCloseAt: target }));
    }
    return { error };
  }, [session.id]);

  const clearAutoCloseTimerAction = useCallback(async () => {
    if (!session.id) return { error: 'No active session' };
    const { error } = await api.clearAutoCloseTimer(session.id);
    if (!error) setSessionState(s => ({ ...s, autoCloseAt: null }));
    return { error };
  }, [session.id]);

  const setTotalDataSetLimitAction = useCallback(async (value: number) => {
    if (!session.id) return { error: 'No active session' };
    const { error } = await api.setTotalDataSetLimit(session.id, value);
    if (!error) setSessionState(s => ({ ...s, totalDataSetLimit: value }));
    return { error };
  }, [session.id]);

  const setEntryHoldAction = useCallback(async (minutes: number) => {
    if (!session.id) return { error: 'No active session' };
    if (!Number.isFinite(minutes) || minutes <= 0) return { error: 'Enter a number of minutes greater than 0' };
    const { error } = await api.setEntryHold(session.id, minutes);
    if (!error) {
      const target = new Date(Date.now() + minutes * 60_000).toISOString();
      setSessionState(s => ({ ...s, entryHoldUntil: target }));
    }
    return { error };
  }, [session.id]);

  const clearEntryHoldAction = useCallback(async () => {
    if (!session.id) return { error: 'No active session' };
    const { error } = await api.clearEntryHold(session.id);
    if (!error) setSessionState(s => ({ ...s, entryHoldUntil: null }));
    return { error };
  }, [session.id]);

  // --- warnings ---
  const sendWarningAction = useCallback(async (message: string, target: 'all' | 'users' | 'partners') => {
    if (!session.id) return { error: 'No active session' };
    const { error } = await api.sendWarning({ sessionId: session.id, message, target, createdBy: currentUserId });
    if (!error) setWarningsState(await api.fetchWarnings(session.id));
    return { error };
  }, [session.id, currentUserId]);

  const retractWarningAction = useCallback(async (id: string) => {
    const { error } = await api.retractWarning(id);
    if (!error && session.id) setWarningsState(await api.fetchWarnings(session.id));
    return { error };
  }, [session.id]);

  // --- entry limits ---
  const setLimitsDefaultAction = useCallback(async (value: number) => {
    if (!session.id) return { error: 'No active session' };
    const { error } = await api.setLimitsDefault(session.id, users.map(u => u.id), value);
    if (!error) setLimitTableState(await api.fetchLimitTable(session.id));
    return { error };
  }, [session.id, users]);

  const setLimitRowAction = useCallback(async (number: string, value: number) => {
    if (!session.id) return { error: 'No active session' };
    const { error } = await api.setLimitRow(session.id, users.map(u => u.id), number, value);
    if (!error) setLimitTableState(await api.fetchLimitTable(session.id));
    return { error };
  }, [session.id, users]);

  const setLimitForDigitAction = useCallback(async (digit: string, value: number) => {
    if (!session.id) return { error: 'No active session' };
    const { error, affectedNumbers } = await api.setLimitForDigit(session.id, users.map(u => u.id), digit, value);
    if (!error) setLimitTableState(await api.fetchLimitTable(session.id));
    return { error, affectedNumbers };
  }, [session.id, users]);

  // Persists a draft table (built via Quick Set / Quick Select by Number /
  // row edits in EntryLimits.tsx, none of which call the server directly
  // anymore) to all managed users, or only the given subset.
  const assignLimitTableAction = useCallback(async (rows: { number: string; limit: number }[], userIds?: string[]) => {
    if (!session.id) return { error: 'No active session' };
    const targets = userIds && userIds.length > 0 ? userIds : users.map(u => u.id);
    if (targets.length === 0) return { error: 'No users to assign to' };
    const { error } = await api.assignLimitTableToUsers(session.id, targets, rows);
    if (!error) setLimitTableState(await api.fetchLimitTable(session.id));
    return { error };
  }, [session.id, users]);

  // --- bet entries / distribution / pnl ---
  const submitBetEntriesAction = useCallback(async (entries: { number: string; amount: number }[]) => {
    if (!session.id) return { results: [], insertedCount: 0, error: 'No active session' };
    const res = await api.submitBetEntries(session.id, entries);
    if (res.insertedCount > 0) setBetEntriesState(await api.fetchBetEntries(session.id));
    return res;
  }, [session.id]);

  const previewDistributionAction = useCallback(async (shareMethod: ShareMethod, setLimit: number, partnerIds?: string[]) => {
    if (!session.id) return { error: 'No active session' };
    return api.distributeOverLimit({ sessionId: session.id, shareMethod, setLimit, partnerIds, dryRun: true });
  }, [session.id]);

  const confirmDistributionAction = useCallback(async (shareMethod: ShareMethod, setLimit: number, partnerIds?: string[]) => {
    if (!session.id) return { error: 'No active session' };
    const res = await api.distributeOverLimit({ sessionId: session.id, shareMethod, setLimit, partnerIds, dryRun: false });
    if (!res.error) {
      await api.setSessionShareMethod(session.id, shareMethod);
      setSessionState(s => ({ ...s, shareMethod }));
      // No explicit refreshAdminPnl() here — setPartnerSharesState below
      // already triggers the reactive P&L effect (keyed on partnerShares),
      // so an extra call here would just double the calculate-pnl
      // invocation for the same distribution event.
      setPartnerSharesState(await api.fetchPartnerShares(session.id));
      setShareHistoryState(await api.fetchShareHistory(session.id));
    }
    return res;
  }, [session.id]);

  const previewDeleteHistoryAction = useCallback(async (sessionId: string) => {
    return api.deleteSessionHistory(sessionId, true);
  }, []);

  const confirmDeleteHistoryAction = useCallback(async (sessionId: string) => {
    const res = await api.deleteSessionHistory(sessionId, false);
    // The deleted session might be the currently live one (its bet entries,
    // share history, and partner shares are all loaded into App state), or
    // it might be a past session nobody currently has open — refreshAll()
    // handles both correctly with one call rather than needing to special-
    // case which session was targeted.
    if (!res.error) await refreshAll();
    return res;
  }, [refreshAll]);

  const sendPartnerOverLimitAction = useCallback(async (subLimit: number) => {
    if (!session.id) return { error: 'No active session' };
    const res = await api.sendPartnerOverLimit(session.id, subLimit);
    if (!res.error) {
      setPartnerOverLimitHistoryState(await api.fetchPartnerOverLimitHistory(session.id));
    }
    return res;
  }, [session.id]);

  const setMySubLimitAction = useCallback(async (value: number) => {
    if (!Number.isFinite(value) || value < 0) return { error: 'Enter a valid sub-limit value' };
    const { error } = await api.setMySubLimit(value);
    if (!error) setPartnersState(await api.fetchManagedPartners());
    return { error };
  }, []);

  const setMyAdminRatesAction = useCallback(async (commissionRate: number, payoutRate: number) => {
    if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100) return { error: 'Commission must be 0–100' };
    if (!Number.isFinite(payoutRate) || payoutRate < 1) return { error: 'Payout must be a positive number' };
    const { error } = await api.setMyAdminRates(commissionRate, payoutRate);
    if (!error) setMyProfile(p => (p ? { ...p, commissionRate, payoutRate } : p));
    return { error };
  }, []);

  // --- on-demand historical session lookups (session history pickers) ---
  // Plain pass-throughs — no local state involved, so selecting a past
  // session in one component's picker can never clobber the live
  // current-session data everything else on screen is reading from.
  const fetchSessionBetEntriesAction = useCallback((sessionId: string) => api.fetchBetEntries(sessionId), []);
  const fetchSessionPartnerSharesAction = useCallback((sessionId: string) => api.fetchPartnerShares(sessionId), []);
  const fetchSessionPnlAction = useCallback((sessionId: string) => api.calculatePnl(sessionId), []);
  const fetchSessionShareHistoryAction = useCallback((sessionId: string) => api.fetchShareHistory(sessionId), []);

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center" style={{ background: C.bg, color: C.text }}>
        <div style={{ maxWidth: 480, textAlign: 'center', padding: 24 }}>
          <p style={{ color: C.gold, fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Supabase not configured</p>
          <p style={{ color: C.textMuted, fontSize: 13, lineHeight: 1.7 }}>
            Copy <code style={{ color: C.text }}>.env.example</code> to <code style={{ color: C.text }}>.env</code> in
            the project root, fill in your Supabase project URL and anon key (Dashboard → Project Settings → API),
            then restart the dev server.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center" style={{ background: C.bg, color: C.text }}>
        <p style={{ color: C.textMuted, fontSize: 14 }}>Loading Treasure…</p>
      </div>
    );
  }

  return (
    <AppContext.Provider value={{
      loading, role, currentUserId, session, users, partners, admins,
      betEntries, limitTable, partnerShares, shareHistory, partnerOverLimitHistory, warnings, adminPnl, myProfile, allSessions,
      login, logout,
      createAccount, updateAccount, toggleAccountActive, deactivateAccount, toggleUserDataEntry,
      openSession: openSessionAction, closeSession: closeSessionAction, setWinningNumber: setWinningNumberAction,
      setAutoCloseTimer: setAutoCloseTimerAction, clearAutoCloseTimer: clearAutoCloseTimerAction,
      setTotalDataSetLimit: setTotalDataSetLimitAction,
      setEntryHold: setEntryHoldAction, clearEntryHold: clearEntryHoldAction,
      sendWarning: sendWarningAction, retractWarning: retractWarningAction,
      setLimitsDefault: setLimitsDefaultAction, setLimitRow: setLimitRowAction, setLimitForDigit: setLimitForDigitAction,
      assignLimitTable: assignLimitTableAction,
      submitBetEntries: submitBetEntriesAction,
      previewDistribution: previewDistributionAction, confirmDistribution: confirmDistributionAction,
      previewDeleteHistory: previewDeleteHistoryAction, confirmDeleteHistory: confirmDeleteHistoryAction,
      sendPartnerOverLimit: sendPartnerOverLimitAction,
      setMySubLimit: setMySubLimitAction,
      setMyAdminRates: setMyAdminRatesAction,
      fetchSessionBetEntries: fetchSessionBetEntriesAction,
      fetchSessionPartnerShares: fetchSessionPartnerSharesAction,
      fetchSessionPnl: fetchSessionPnlAction,
      fetchSessionShareHistory: fetchSessionShareHistoryAction,
      refreshAdminPnl, refreshAll,
    }}>
      <Toaster richColors position="top-right" />
      {role === 'login' && <LoginScreen />}
      <Suspense fallback={<RouteFallback />}>
        {(role === 'admin' || role === 'masterAdmin') && <AdminLayout />}
        {role === 'user' && <UserLayout />}
        {role === 'partner' && <PartnerLayout />}
      </Suspense>
    </AppContext.Provider>
  );
}
