export type Role = 'login' | 'admin' | 'masterAdmin' | 'user' | 'partner';
export type SessionStatus = 'open' | 'closed';
export type ShareMethod = 'percentage' | 'equally';

export interface Session {
  id: string;
  /** Human-friendly label, e.g. "07-07-2026 (AM)" — use this for display. */
  label: string;
  status: SessionStatus;
  openedAt: string;
  closedAt?: string;
  winningNumber: string | null;
  shareMethod: ShareMethod;
  /** When set (and status is still 'open'), the session auto-closes at this
   * timestamp — a server-side pg_cron job does the actual closing, so this
   * fires even if no one has the app open. Clients just render a countdown. */
  autoCloseAt: string | null;
  /** Persisted "Total Data" over-limit threshold (see admin/TotalData.tsx).
   * Stored on the session row so it survives page reloads/navigation and
   * stays in sync across every admin viewing this session — it used to be
   * ephemeral component state that silently reset to a hardcoded default. */
  totalDataSetLimit: number | null;
  /** When set (and in the future), bet-entry submissions are temporarily
   * paused for everyone — the session itself stays "open". Unlike
   * autoCloseAt, nothing needs to actively clear this: it's just a
   * timestamp comparison at insert-time (RLS + submit_bet_entries RPC), so
   * it self-expires the moment now() passes it. */
  entryHoldUntil: string | null;
}

export interface UserAccount {
  id: string;
  username: string;
  commissionRate: number;
  payoutRate: number;
  isActive: boolean;
  /** Per-session gate an Admin can flip independently of the global session
   * status — closing it blocks just this user's bet submissions without
   * closing the session for everyone else. Resets to true on a new session. */
  dataEntryOpen: boolean;
}

export interface PartnerAccount {
  id: string;
  username: string;
  commissionRate: number;
  payoutRate: number;
  sharePercentage: number;
  isActive: boolean;
  /** The partner's own persisted "My Sub-Limit" setting (PartnerLayout.tsx)
   * — null until they've applied one, in which case the UI falls back to a
   * hardcoded default. Stored on their own account row (not the session)
   * since it's their standing preference, not a per-session decision. */
  subLimitValue: number | null;
}

/** Admin accounts, manageable only by Master Admin (the superuser role). */
export interface AdminAccount {
  id: string;
  username: string;
  commissionRate: number;
  payoutRate: number;
  isActive: boolean;
}

export interface BetEntry {
  id: string;
  userId: string;
  number: string;
  amount: number;
  timestamp: string;
}

export interface LimitRow {
  number: string;
  limit: number;
}

export interface PartnerShare {
  partnerId: string;
  number: string;
  sharedAmount: number;
}

export interface WarningMessage {
  id: string;
  message: string;
  targetRole: 'users' | 'partners' | 'all';
  targetIds?: string[];
  dismissedBy: string[];
  createdAt: string;
}

/** Result of calculate_pnl RPC for the Admin account (see spec §4.3). */
export interface AdminPnl {
  grossIntake: number;
  commissionTotal: number;
  netIntake: number;
  payout: number | null;
  netPnl: number | null;
  winningNumberSet: boolean;
}

/** One line result from the submit_bet_entries RPC. */
export interface BetSubmitResult {
  line: number;
  number: string | null;
  amount: number | null;
  status: 'ok' | 'error';
  message?: string;
  remaining?: number;
  entryId?: string;
}

/** Preview or confirmed breakdown from the distribute_over_limit RPC. */
export interface DistributionResult {
  shareMethod: ShareMethod;
  setLimit: number;
  eligibleNumbers: { number: string; totalAmount: number; limitValue: number; overLimitAmount: number }[];
  breakdown: { number: string; partnerId: string; partnerUsername: string; sharedAmount: number }[];
  totalSharedAmount: number;
  dryRun: boolean;
  shareHistoryId?: string;
  message?: string;
}

/**
 * A single confirmed "Share to Partners" action, recorded permanently once
 * distribute_over_limit runs with dryRun=false. Once a number's over-limit
 * amount is captured in a ShareHistoryEntry, it's netted out of the live
 * "over limit" panel (see admin/TotalData.tsx) so it doesn't get shared
 * twice — but the record itself is never deleted, so History always shows
 * the full audit trail and can be copied at any time.
 */
export interface ShareHistoryEntry {
  id: string;
  shareMethod: ShareMethod;
  setLimit: number;
  totalSharedAmount: number;
  createdAt: string;
  overLimitRecords: { number: string; totalAmount: number; limitValue: number; overLimitAmount: number }[];
  partnerBreakdown: { partnerId: string; number: string; sharedAmount: number }[];
}

/**
 * A single confirmed "Send" action from a Partner's Over My Limit panel
 * (send_partner_over_limit RPC) — the partner-side mirror of ShareHistoryEntry.
 * Once a number's over-sub-limit amount is captured here, it's netted out of
 * the live Over My Limit panel (see PartnerLayout.tsx) so pressing Send again
 * doesn't resend the same amount, but the record itself is permanent and can
 * be copied at any time under History.
 */
export interface PartnerOverLimitEntry {
  id: string;
  partnerId: string;
  subLimitUsed: number;
  totalSentAmount: number;
  createdAt: string;
  records: { number: string; totalReceived: number; subLimitValue: number; overLimitAmount: number }[];
}
