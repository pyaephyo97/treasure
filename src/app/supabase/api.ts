import { supabase, FUNCTIONS_URL } from './client';
import type {
  Session, UserAccount, PartnerAccount, AdminAccount, BetEntry, LimitRow, PartnerShare, WarningMessage,
  AdminPnl, BetSubmitResult, DistributionResult, ShareMethod, ShareHistoryEntry, PartnerOverLimitEntry,
  DeleteHistoryResult,
} from '../types';
import {
  type AccountRow, type SessionRow, type BetEntryRow, type EntryLimitRow,
  type PartnerShareRow, type WarningMessageRow, type DbRole,
  accountRowToUser, accountRowToPartner, accountRowToAdmin, sessionRowToSession, makeSessionLabel,
  betEntryRowToBetEntry, entryLimitRowsToLimitTable, partnerShareRowToPartnerShare,
  warningRowToWarningMessage,
} from './mappers';

// ============================================================================
// Auth
// ============================================================================

function synthesizeEmail(username: string): string {
  return `${username.toLowerCase()}@users.treasure.internal`;
}

export async function login(usernameOrEmail: string, password: string): Promise<{ error?: string }> {
  const email = usernameOrEmail.includes('@') ? usernameOrEmail : synthesizeEmail(usernameOrEmail);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error?.message };
}

export async function logout(): Promise<void> {
  await supabase.auth.signOut();
}

export interface MyAccount {
  id: string;
  role: DbRole;
  username: string;
  commissionRate: number;
  payoutRate: number;
}

/** Looks up the accounts row for the currently authenticated auth.users id.
 * Includes commission/payout rate now too — used to populate Admin's own
 * self-service Profile page (see admin/AdminProfile.tsx). */
export async function getMyAccount(): Promise<MyAccount | null> {
  const { data: authData } = await supabase.auth.getUser();
  const authUserId = authData?.user?.id;
  if (!authUserId) return null;

  const { data, error } = await supabase
    .from('accounts')
    .select('id, role, username, commission_rate, payout_rate')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id,
    role: data.role,
    username: data.username,
    commissionRate: Number(data.commission_rate),
    payoutRate: Number(data.payout_rate),
  };
}

/** Self-service update for an Admin/Master Admin's OWN commission rate and
 * payout rate — via the set_my_admin_rates RPC, since accounts_update_managed
 * RLS only lets the account's creator update it (an Admin never created
 * themselves, so they couldn't otherwise touch their own row at all). */
export async function setMyAdminRates(commissionRate: number, payoutRate: number): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('set_my_admin_rates', { p_commission_rate: commissionRate, p_payout_rate: payoutRate });
  return { error: error?.message };
}

// ============================================================================
// Fetchers
// ============================================================================

export async function fetchLatestSession(): Promise<Session | null> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return sessionRowToSession(data as SessionRow);
}

/** Every session ever opened, newest first — for the "pick a session by
 * name" history pickers (UserLayout/PartnerLayout/AdminReports). No data
 * migration was needed for this: bet_entries, partner_shares, entry_limits,
 * warning_messages, share_history and partner_over_limit_history are all
 * already permanently keyed by session_id and were never deleted when a new
 * session opened — the only thing missing was a way to list past sessions
 * to pick from, since the app only ever fetched the single latest one. */
export async function fetchAllSessions(): Promise<Session[]> {
  // Capped at 200 — plenty for the "pick a session by name" history pickers
  // (months of twice-daily sessions) without the payload growing unbounded
  // forever as more sessions accumulate.
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error || !data) return [];
  return (data as SessionRow[]).map(sessionRowToSession);
}

export async function fetchManagedUsers(): Promise<UserAccount[]> {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('role', 'user')
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return (data as AccountRow[]).map(accountRowToUser);
}

export async function fetchManagedPartners(): Promise<PartnerAccount[]> {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('role', 'partner')
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return (data as AccountRow[]).map(accountRowToPartner);
}

/** Admin accounts — only Master Admin's RLS grant (is_master_admin()) sees
 * every row here; a plain Admin querying this will just get an empty list
 * back (accounts_select only lets them see accounts they created), which is
 * fine since only Master Admin's UI ever renders this list. */
export async function fetchManagedAdmins(): Promise<AdminAccount[]> {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('role', 'admin')
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return (data as AccountRow[]).map(accountRowToAdmin);
}

export async function fetchBetEntries(sessionId: string): Promise<BetEntry[]> {
  const { data, error } = await supabase
    .from('bet_entries')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return (data as BetEntryRow[]).map(betEntryRowToBetEntry);
}

export async function fetchLimitTable(sessionId: string): Promise<LimitRow[]> {
  const { data, error } = await supabase
    .from('entry_limits')
    .select('session_id, user_id, number, limit_value')
    .eq('session_id', sessionId);
  if (error || !data) return entryLimitRowsToLimitTable([]);
  return entryLimitRowsToLimitTable(data as EntryLimitRow[]);
}

export async function fetchPartnerShares(sessionId: string): Promise<PartnerShare[]> {
  const { data, error } = await supabase
    .from('partner_shares')
    .select('*')
    .eq('session_id', sessionId);
  if (error || !data) return [];
  return (data as PartnerShareRow[]).map(partnerShareRowToPartnerShare);
}

interface ShareHistoryRow {
  id: string;
  share_method: 'percentage' | 'equally';
  set_limit_used: number;
  total_shared_amount: number;
  created_at: string;
}

interface OverLimitRecordRow {
  id: string;
  share_history_id: string;
  number: string;
  total_amount: number;
  limit_value: number;
  over_limit_amount: number;
}

interface PartnerShareHistoryRow {
  id: string;
  share_history_id: string;
  partner_id: string;
  number: string;
  shared_amount: number;
}

/**
 * Past confirmed "Share to Partners" actions for this session, each with its
 * own over-limit breakdown and per-partner distribution. Three separate flat
 * queries (rather than a nested PostgREST embed) joined client-side by
 * share_history_id — simpler to reason about and keeps each query aligned
 * with a single straightforward RLS policy.
 */
export async function fetchShareHistory(sessionId: string): Promise<ShareHistoryEntry[]> {
  const [shRes, olrRes, psRes] = await Promise.all([
    supabase.from('share_history').select('*').eq('session_id', sessionId).order('created_at', { ascending: false }),
    supabase.from('over_limit_records').select('*').eq('session_id', sessionId),
    supabase.from('partner_shares').select('*').eq('session_id', sessionId),
  ]);

  const shRows = (shRes.data ?? []) as ShareHistoryRow[];
  const olrRows = (olrRes.data ?? []) as OverLimitRecordRow[];
  const psRows = (psRes.data ?? []) as PartnerShareHistoryRow[];

  return shRows.map(sh => ({
    id: sh.id,
    shareMethod: sh.share_method,
    setLimit: sh.set_limit_used,
    totalSharedAmount: sh.total_shared_amount,
    createdAt: sh.created_at,
    overLimitRecords: olrRows
      .filter(r => r.share_history_id === sh.id)
      .map(r => ({ number: r.number, totalAmount: r.total_amount, limitValue: r.limit_value, overLimitAmount: r.over_limit_amount })),
    partnerBreakdown: psRows
      .filter(r => r.share_history_id === sh.id)
      .map(r => ({ partnerId: r.partner_id, number: r.number, sharedAmount: r.shared_amount })),
  }));
}

interface PartnerOverLimitHistoryRow {
  id: string;
  partner_id: string;
  sub_limit_used: number;
  total_sent_amount: number;
  created_at: string;
}

interface PartnerOverLimitRecordRow {
  id: string;
  history_id: string;
  number: string;
  total_received: number;
  sub_limit_value: number;
  over_limit_amount: number;
}

/**
 * Past confirmed "Send" actions from Partner's Over My Limit panel, for this
 * session. Same two-flat-queries-joined-client-side shape as
 * fetchShareHistory. RLS already scopes rows to the calling partner's own
 * (or, for admins, every partner's) — this fetch is session-scoped only,
 * PartnerLayout.tsx filters by partnerId === currentUserId when rendering.
 */
export async function fetchPartnerOverLimitHistory(sessionId: string): Promise<PartnerOverLimitEntry[]> {
  const [hRes, rRes] = await Promise.all([
    supabase.from('partner_over_limit_history').select('*').eq('session_id', sessionId).order('created_at', { ascending: false }),
    supabase.from('partner_over_limit_records').select('*').eq('session_id', sessionId),
  ]);

  const hRows = (hRes.data ?? []) as PartnerOverLimitHistoryRow[];
  const rRows = (rRes.data ?? []) as PartnerOverLimitRecordRow[];

  return hRows.map(h => ({
    id: h.id,
    partnerId: h.partner_id,
    subLimitUsed: h.sub_limit_used,
    totalSentAmount: h.total_sent_amount,
    createdAt: h.created_at,
    records: rRows
      .filter(r => r.history_id === h.id)
      .map(r => ({ number: r.number, totalReceived: r.total_received, subLimitValue: r.sub_limit_value, overLimitAmount: r.over_limit_amount })),
  }));
}

/** Persists a Partner's own "My Sub-Limit" setting on their account row, via
 * the set_my_sub_limit RPC (accounts_update_managed RLS doesn't allow a
 * partner to update their own row directly, so this needs an RPC rather
 * than a plain table update). Fixes the same class of bug as
 * setTotalDataSetLimit — the value used to be local component state that
 * silently reset to a hardcoded default on every reload. */
export async function setMySubLimit(value: number): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('set_my_sub_limit', { p_value: value });
  return { error: error?.message };
}

/** Partner-side "Send": archives the currently-outstanding over-sub-limit
 * amount (per number, summed across every share received so far minus
 * whatever's already been sent) via the send_partner_over_limit RPC — this
 * is what makes it drop off the live Over My Limit panel and reappear as a
 * copyable History entry. */
export async function sendPartnerOverLimit(sessionId: string, subLimit: number): Promise<{ error?: string; totalSentAmount?: number; message?: string }> {
  const { data, error } = await supabase.rpc('send_partner_over_limit', { p_session_id: sessionId, p_sub_limit: subLimit });
  if (error) return { error: error.message };
  return { totalSentAmount: data?.total_sent_amount ?? 0, message: data?.message };
}

/** Admin "Delete History": clears a session's user-submitted bet entries and
 * admin share-to-partner records (share_history, cascading to
 * over_limit_records/partner_shares) via the delete_session_history RPC.
 * dryRun=true previews the counts without deleting anything — same
 * preview-then-confirm shape as distributeOverLimit. Regular Admins are
 * scoped server-side to their own managed users/share actions; Master Admin
 * clears everything for the session. */
export async function deleteSessionHistory(sessionId: string, dryRun: boolean): Promise<{ result?: DeleteHistoryResult; error?: string }> {
  const { data, error } = await supabase.rpc('delete_session_history', { p_session_id: sessionId, p_dry_run: dryRun });
  if (error) return { error: error.message };
  const result: DeleteHistoryResult = {
    sessionId: data?.session_id ?? sessionId,
    betEntriesCount: data?.bet_entries_count ?? 0,
    shareHistoryCount: data?.share_history_count ?? 0,
    totalSharedAmount: data?.total_shared_amount ?? 0,
    dryRun: data?.dry_run ?? dryRun,
  };
  return { result };
}

export async function fetchWarnings(sessionId: string): Promise<WarningMessage[]> {
  const { data, error } = await supabase
    .from('warning_messages')
    .select('*')
    .eq('session_id', sessionId)
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return (data as WarningMessageRow[]).map(warningRowToWarningMessage);
}

// ============================================================================
// Account mutations
// ============================================================================

export interface CreateAccountPayload {
  role: 'user' | 'partner' | 'admin';
  username: string;
  password: string;
  commissionRate: number;
  payoutRate: number;
  dataSharePercentage?: number;
}

export async function createAccount(payload: CreateAccountPayload): Promise<{ error?: string }> {
  try {
    const result = await callEdgeFunction('create-account', {
      role: payload.role,
      username: payload.username,
      password: payload.password,
      commissionRate: payload.commissionRate,
      payoutRate: payload.payoutRate,
      dataSharePercentage: payload.dataSharePercentage ?? null,
    });
    if (result?.error) return { error: result.error };
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to create account' };
  }
}

export async function updateAccount(
  id: string,
  patch: { username?: string; commissionRate?: number; payoutRate?: number; sharePercentage?: number }
): Promise<{ error?: string }> {
  const dbPatch: Record<string, unknown> = {};
  if (patch.username !== undefined) dbPatch.username = patch.username;
  if (patch.commissionRate !== undefined) dbPatch.commission_rate = patch.commissionRate;
  if (patch.payoutRate !== undefined) dbPatch.payout_rate = patch.payoutRate;
  if (patch.sharePercentage !== undefined) dbPatch.data_share_percentage = patch.sharePercentage;

  const { error } = await supabase.from('accounts').update(dbPatch).eq('id', id);
  return { error: error?.message };
}

export async function setAccountActive(id: string, isActive: boolean): Promise<{ error?: string }> {
  const { error } = await supabase.from('accounts').update({ is_active: isActive }).eq('id', id);
  return { error: error?.message };
}

/** Opens/closes a single User's ability to submit bet entries for the
 * current session, independent of the global session status — see
 * bet_entries_insert_own RLS policy and submit_bet_entries RPC. */
export async function setUserDataEntryOpen(id: string, isOpen: boolean): Promise<{ error?: string }> {
  const { error } = await supabase.from('accounts').update({ data_entry_open: isOpen }).eq('id', id);
  return { error: error?.message };
}

// ============================================================================
// Session mutations
// ============================================================================

export async function openSession(createdBy: string): Promise<{ session?: Session; error?: string }> {
  const now = new Date();
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      label: makeSessionLabel(now),
      status: 'open',
      opened_at: now.toISOString(),
      created_by: createdBy,
    })
    .select('*')
    .single();

  if (error || !data) return { error: error?.message ?? 'Failed to open session' };

  // Fresh session = a clean slate: re-open entry for any users an admin had
  // previously closed. RLS (accounts_update_managed) already scopes this to
  // just the calling admin's own managed users (or everyone, for Master
  // Admin), so no explicit created_by filter is needed here.
  await supabase.from('accounts').update({ data_entry_open: true }).eq('role', 'user');

  return { session: sessionRowToSession(data as SessionRow) };
}

export async function closeSession(sessionId: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('sessions')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', sessionId);
  return { error: error?.message };
}

export async function setWinningNumber(sessionId: string, number: string): Promise<{ error?: string }> {
  const { error } = await supabase.from('sessions').update({ winning_number: number }).eq('id', sessionId);
  return { error: error?.message };
}

export async function setSessionShareMethod(sessionId: string, method: ShareMethod): Promise<{ error?: string }> {
  const { error } = await supabase.from('sessions').update({ share_method: method }).eq('id', sessionId);
  return { error: error?.message };
}

/** Starts (or replaces) the auto-close countdown: closes the session
 * `minutes` from now. The actual close is performed server-side by a
 * pg_cron job (auto_close_expired_sessions), not by any client. */
export async function setAutoCloseTimer(sessionId: string, minutes: number): Promise<{ error?: string }> {
  const target = new Date(Date.now() + minutes * 60_000).toISOString();
  const { error } = await supabase.from('sessions').update({ auto_close_at: target }).eq('id', sessionId);
  return { error: error?.message };
}

export async function clearAutoCloseTimer(sessionId: string): Promise<{ error?: string }> {
  const { error } = await supabase.from('sessions').update({ auto_close_at: null }).eq('id', sessionId);
  return { error: error?.message };
}

/** Persists the Total Data over-limit threshold on the session row so it
 * survives reloads/navigation and stays in sync for every admin viewing
 * this session (see admin/TotalData.tsx). */
export async function setTotalDataSetLimit(sessionId: string, value: number): Promise<{ error?: string }> {
  const { error } = await supabase.from('sessions').update({ total_data_set_limit: value }).eq('id', sessionId);
  return { error: error?.message };
}

/** Temporarily pauses bet-entry submissions for everyone for `minutes`,
 * without closing the session — e.g. to freeze entries while Admin reviews
 * data. Enforced server-side (RLS + submit_bet_entries RPC both check
 * entry_hold_until), so this self-expires even if no client is open; no
 * cron job needed since it's a plain timestamp comparison, not a status
 * flip. */
export async function setEntryHold(sessionId: string, minutes: number): Promise<{ error?: string }> {
  const target = new Date(Date.now() + minutes * 60_000).toISOString();
  const { error } = await supabase.from('sessions').update({ entry_hold_until: target }).eq('id', sessionId);
  return { error: error?.message };
}

export async function clearEntryHold(sessionId: string): Promise<{ error?: string }> {
  const { error } = await supabase.from('sessions').update({ entry_hold_until: null }).eq('id', sessionId);
  return { error: error?.message };
}

// ============================================================================
// Warning messages
// ============================================================================

export async function sendWarning(params: {
  sessionId: string;
  message: string;
  target: 'all' | 'users' | 'partners';
  createdBy: string;
}): Promise<{ error?: string }> {
  const rows: { session_id: string; message: string; audience_role: 'user' | 'partner'; created_by: string }[] = [];
  if (params.target === 'all' || params.target === 'users') {
    rows.push({ session_id: params.sessionId, message: params.message, audience_role: 'user', created_by: params.createdBy });
  }
  if (params.target === 'all' || params.target === 'partners') {
    rows.push({ session_id: params.sessionId, message: params.message, audience_role: 'partner', created_by: params.createdBy });
  }
  const { error } = await supabase.from('warning_messages').insert(rows);
  return { error: error?.message };
}

export async function retractWarning(id: string): Promise<{ error?: string }> {
  const { error } = await supabase.from('warning_messages').update({ is_active: false }).eq('id', id);
  return { error: error?.message };
}

// ============================================================================
// Entry limits (see mappers.ts note: one flat table fanned out to every
// managed user, matching the existing UI's simplification)
// ============================================================================

export async function setLimitsDefault(
  sessionId: string,
  userIds: string[],
  value: number
): Promise<{ error?: string }> {
  const rows: { session_id: string; user_id: string; number: string; limit_value: number }[] = [];
  for (const userId of userIds) {
    for (let i = 0; i < 100; i++) {
      rows.push({ session_id: sessionId, user_id: userId, number: String(i).padStart(2, '0'), limit_value: value });
    }
  }
  if (rows.length === 0) return {};
  const { error } = await supabase
    .from('entry_limits')
    .upsert(rows, { onConflict: 'session_id,user_id,number' });
  return { error: error?.message };
}

export async function setLimitRow(
  sessionId: string,
  userIds: string[],
  number: string,
  value: number
): Promise<{ error?: string }> {
  const rows = userIds.map(userId => ({ session_id: sessionId, user_id: userId, number, limit_value: value }));
  if (rows.length === 0) return {};
  const { error } = await supabase
    .from('entry_limits')
    .upsert(rows, { onConflict: 'session_id,user_id,number' });
  return { error: error?.message };
}

/** Bulk-assigns an arbitrary 100-row table (not necessarily a single
 * uniform value — e.g. a draft table built up in the UI via Quick Set +
 * Quick Select by Number + individual row edits) to one or more users in
 * one batched upsert. This is what EntryLimits.tsx's "Assign to All Users"
 * / "Assign to Selected Users" buttons call — Quick Set / Quick Select /
 * row edits there only mutate a local draft; nothing is persisted until
 * this runs. */
export async function assignLimitTableToUsers(
  sessionId: string,
  userIds: string[],
  rows: { number: string; limit: number }[]
): Promise<{ error?: string }> {
  const upsertRows: { session_id: string; user_id: string; number: string; limit_value: number }[] = [];
  for (const userId of userIds) {
    for (const row of rows) {
      upsertRows.push({ session_id: sessionId, user_id: userId, number: row.number, limit_value: row.limit });
    }
  }
  if (upsertRows.length === 0) return {};
  const { error } = await supabase
    .from('entry_limits')
    .upsert(upsertRows, { onConflict: 'session_id,user_id,number' });
  return { error: error?.message };
}

/** Numbers 00-99 that contain `digit` in either the tens or ones place —
 * e.g. digit "2" -> 02, 12, 20, 21, 22, ..., 29, 32, 42, ..., 92.
 * Not exported — only used internally by setLimitForDigit below. */
function numbersContainingDigit(digit: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < 100; i++) {
    const n = String(i).padStart(2, '0');
    if (n[0] === digit || n[1] === digit) out.push(n);
  }
  return out;
}

/** Quick-set: applies `value` to every number containing `digit` (in either
 * position) across the given users in one batched upsert. */
export async function setLimitForDigit(
  sessionId: string,
  userIds: string[],
  digit: string,
  value: number
): Promise<{ error?: string; affectedNumbers?: string[] }> {
  const numbers = numbersContainingDigit(digit);
  const rows: { session_id: string; user_id: string; number: string; limit_value: number }[] = [];
  for (const userId of userIds) {
    for (const number of numbers) {
      rows.push({ session_id: sessionId, user_id: userId, number, limit_value: value });
    }
  }
  if (rows.length === 0) return { affectedNumbers: numbers };
  const { error } = await supabase
    .from('entry_limits')
    .upsert(rows, { onConflict: 'session_id,user_id,number' });
  return { error: error?.message, affectedNumbers: numbers };
}

// ============================================================================
// Edge Functions
// ============================================================================

async function callEdgeFunction(name: string, body: unknown): Promise<any> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error || `${name} failed (${res.status})`);
  }
  return json;
}

export async function submitBetEntries(
  sessionId: string,
  entries: { number: string; amount: number }[]
): Promise<{ results: BetSubmitResult[]; insertedCount: number; error?: string }> {
  try {
    const json = await callEdgeFunction('validate-bet-entry', { sessionId, entries });
    return { results: json.results ?? [], insertedCount: json.inserted_count ?? 0 };
  } catch (err) {
    return { results: [], insertedCount: 0, error: err instanceof Error ? err.message : 'Submission failed' };
  }
}

export async function distributeOverLimit(params: {
  sessionId: string;
  shareMethod: ShareMethod;
  setLimit: number;
  partnerIds?: string[];
  dryRun: boolean;
}): Promise<{ result?: DistributionResult; error?: string }> {
  try {
    const json = await callEdgeFunction('distribute-over-limit', {
      sessionId: params.sessionId,
      shareMethod: params.shareMethod,
      setLimit: params.setLimit,
      partnerIds: params.partnerIds ?? null,
      dryRun: params.dryRun,
    });
    const result: DistributionResult = {
      shareMethod: json.share_method,
      setLimit: json.set_limit,
      eligibleNumbers: (json.eligible_numbers ?? []).map((r: any) => ({
        number: r.number, totalAmount: r.total_amount, limitValue: r.limit_value, overLimitAmount: r.over_limit_amount,
      })),
      breakdown: (json.breakdown ?? []).map((b: any) => ({
        number: b.number, partnerId: b.partner_id, partnerUsername: b.partner_username, sharedAmount: b.shared_amount,
      })),
      totalSharedAmount: json.total_shared_amount ?? 0,
      dryRun: json.dry_run ?? params.dryRun,
      shareHistoryId: json.share_history_id,
      message: json.message,
    };
    return { result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Distribution failed' };
  }
}

export async function calculatePnl(sessionId: string, accountId?: string): Promise<{ pnl?: AdminPnl; error?: string }> {
  try {
    const json = await callEdgeFunction('calculate-pnl', { sessionId, accountId: accountId ?? null });
    const pnl: AdminPnl = {
      grossIntake: json.gross_intake ?? 0,
      commissionTotal: json.commission_total ?? 0,
      netIntake: json.net_intake ?? 0,
      payout: json.payout,
      netPnl: json.net_pnl,
      winningNumberSet: !!json.winning_number_set,
    };
    return { pnl };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'P&L calculation failed' };
  }
}

// ============================================================================
// Realtime
// ============================================================================

export function subscribeToSession(onChange: () => void) {
  const channel = supabase
    .channel('sessions-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export function subscribeToWarnings(sessionId: string, onChange: () => void) {
  const channel = supabase
    .channel(`warnings-changes-${sessionId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'warning_messages', filter: `session_id=eq.${sessionId}` }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export function subscribeToBetEntries(sessionId: string, onChange: () => void) {
  const channel = supabase
    .channel(`bet-entries-changes-${sessionId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bet_entries', filter: `session_id=eq.${sessionId}` }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export function subscribeToPartnerShares(sessionId: string, onChange: () => void) {
  const channel = supabase
    .channel(`partner-shares-changes-${sessionId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'partner_shares', filter: `session_id=eq.${sessionId}` }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export function subscribeToPartnerOverLimitHistory(sessionId: string, onChange: () => void) {
  const channel = supabase
    .channel(`partner-over-limit-history-changes-${sessionId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'partner_over_limit_history', filter: `session_id=eq.${sessionId}` }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

/**
 * Live updates for the CURRENT user's own accounts row — without this, an
 * Admin flipping someone's data_entry_open (or commission/payout/is_active)
 * from Account Management never reaches that person's already-open tab; they
 * stay stuck on stale state (e.g. "Your Entry Is Closed") until they
 * manually reload. RLS (accounts_select) already lets a user see their own
 * row, so this is allowed for every role.
 */
export function subscribeToMyAccount(accountId: string, onChange: () => void) {
  const channel = supabase
    .channel(`my-account-changes-${accountId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts', filter: `id=eq.${accountId}` }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
