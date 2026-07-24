import { createContext, useContext } from 'react';
import type {
  Role, Session, UserAccount, PartnerAccount, AdminAccount,
  BetEntry, LimitRow, PartnerShare, WarningMessage,
  AdminPnl, BetSubmitResult, DistributionResult, ShareMethod, ShareHistoryEntry, PartnerOverLimitEntry,
  DeleteHistoryResult,
} from './types';

export type AccountTab = 'users' | 'partners' | 'admins';

export interface AppCtx {
  loading: boolean;
  role: Role;
  currentUserId: string;
  session: Session;
  users: UserAccount[];
  partners: PartnerAccount[];
  /** Admin accounts. Only populated for Master Admin — see fetchManagedAdmins. */
  admins: AdminAccount[];
  betEntries: BetEntry[];
  limitTable: LimitRow[];
  partnerShares: PartnerShare[];
  /** Past confirmed "Share to Partners" actions for the current session. */
  shareHistory: ShareHistoryEntry[];
  /** Past confirmed "Send" actions from a Partner's Over My Limit panel, for the current session (session-scoped; filter by partnerId client-side). */
  partnerOverLimitHistory: PartnerOverLimitEntry[];
  warnings: WarningMessage[];
  /** Admin's own P&L for the current session, via the calculate_pnl RPC. Null until a winning number is set or while (re)loading. */
  adminPnl: AdminPnl | null;
  /** The logged-in Admin/Master Admin's own account snapshot — username + their own commission/payout rate (see admin/AdminProfile.tsx). Null for non-admin roles or before it's loaded. */
  myProfile: { username: string; commissionRate: number; payoutRate: number } | null;
  /** Every session ever opened, newest first — for "select a session by name" history pickers. Nothing is ever deleted on a new session opening, so this is just a full listing. */
  allSessions: Session[];

  // --- auth ---
  login: (usernameOrEmail: string, password: string) => Promise<{ error?: string }>;
  logout: () => Promise<void>;

  // --- accounts ---
  // Master Admin is a superuser: it may create 'admin' accounts (regular
  // Admins cannot) in addition to 'user' and 'partner' accounts.
  createAccount: (payload: {
    role: 'user' | 'partner' | 'admin';
    username: string;
    password: string;
    commissionRate: number;
    payoutRate: number;
    sharePercentage?: number;
  }) => Promise<{ error?: string }>;
  updateAccount: (
    id: string,
    tab: AccountTab,
    patch: { username?: string; commissionRate?: number; payoutRate?: number; sharePercentage?: number }
  ) => Promise<{ error?: string }>;
  toggleAccountActive: (id: string, tab: AccountTab) => Promise<{ error?: string }>;
  deactivateAccount: (id: string, tab: AccountTab) => Promise<{ error?: string }>;
  /** Opens/closes a single User's entry for the current session — independent of the global session status. */
  toggleUserDataEntry: (id: string) => Promise<{ error?: string }>;

  // --- session ---
  openSession: () => Promise<{ error?: string }>;
  closeSession: () => Promise<{ error?: string }>;
  setWinningNumber: (number: string) => Promise<{ error?: string }>;
  /** Starts (or replaces) the auto-close countdown, closing the session `minutes` from now. */
  setAutoCloseTimer: (minutes: number) => Promise<{ error?: string }>;
  clearAutoCloseTimer: () => Promise<{ error?: string }>;
  /** Persists the Total Data over-limit threshold on the session row (see admin/TotalData.tsx). */
  setTotalDataSetLimit: (value: number) => Promise<{ error?: string }>;
  /** Pauses entry for everyone for `minutes` without closing the session — self-expires, no need to manually clear. */
  setEntryHold: (minutes: number) => Promise<{ error?: string }>;
  clearEntryHold: () => Promise<{ error?: string }>;

  // --- warnings ---
  sendWarning: (message: string, target: 'all' | 'users' | 'partners') => Promise<{ error?: string }>;
  retractWarning: (id: string) => Promise<{ error?: string }>;

  // --- entry limits ---
  setLimitsDefault: (value: number) => Promise<{ error?: string }>;
  setLimitRow: (number: string, value: number) => Promise<{ error?: string }>;
  /** Sets `value` for every number containing `digit` (00-99, either position) in one action. */
  setLimitForDigit: (digit: string, value: number) => Promise<{ error?: string; affectedNumbers?: string[] }>;
  /** Bulk-assigns an arbitrary 100-row table (built via Quick Set / Quick
   * Select by Number / individual row edits in EntryLimits.tsx, all of
   * which only edit a local draft) to all managed users, or only the given
   * subset if userIds is provided and non-empty. */
  assignLimitTable: (rows: { number: string; limit: number }[], userIds?: string[]) => Promise<{ error?: string }>;

  // --- bet entries / distribution / pnl (server-authoritative) ---
  submitBetEntries: (entries: { number: string; amount: number }[]) => Promise<{ results: BetSubmitResult[]; insertedCount: number; error?: string }>;
  previewDistribution: (shareMethod: ShareMethod, setLimit: number, partnerIds?: string[]) => Promise<{ result?: DistributionResult; error?: string }>;
  confirmDistribution: (shareMethod: ShareMethod, setLimit: number, partnerIds?: string[]) => Promise<{ result?: DistributionResult; error?: string }>;
  refreshAdminPnl: () => Promise<void>;

  /** Admin "Delete History" (admin/SessionControl.tsx): preview how many bet
   * entries / share actions would be permanently deleted for an arbitrary
   * (past or current) session, and whether the session row itself would be
   * removed too, without deleting anything. */
  previewDeleteHistory: (sessionId: string) => Promise<{ result?: DeleteHistoryResult; error?: string }>;
  /** Actually performs the deletion previewed above — also removes the
   * session row itself once its data is cleared, unless data outside the
   * caller's own scope still references it — then refreshes all
   * session-scoped state (bet entries, share history, partner shares,
   * allSessions, etc.) since the deleted session may be the currently live
   * one, or may no longer exist at all. */
  confirmDeleteHistory: (sessionId: string) => Promise<{ result?: DeleteHistoryResult; error?: string }>;

  /** Partner-side "Send" for the currently-outstanding over-sub-limit amount — archives it to History and clears it from the live Over My Limit panel. */
  sendPartnerOverLimit: (subLimit: number) => Promise<{ error?: string; totalSentAmount?: number; message?: string }>;
  /** Persists the Partner's own "My Sub-Limit" setting (see PartnerLayout.tsx). */
  setMySubLimit: (value: number) => Promise<{ error?: string }>;
  /** Persists the logged-in Admin/Master Admin's own commission rate + payout rate. */
  setMyAdminRates: (commissionRate: number, payoutRate: number) => Promise<{ error?: string }>;

  /** Re-fetch everything from Supabase (used after realtime pings and manual refresh). */
  refreshAll: () => Promise<void>;

  // --- on-demand historical session lookups (session history pickers) ---
  // Pass-throughs to the same session-scoped fetchers used for the live
  // session, just called with a PAST session's id instead — these don't
  // touch any global state, so picking a historical session in one tab
  // never disturbs the live current-session view.
  /** My own bet entries for an arbitrary (past or current) session. */
  fetchSessionBetEntries: (sessionId: string) => Promise<BetEntry[]>;
  /** My own partner shares received for an arbitrary (past or current) session. */
  fetchSessionPartnerShares: (sessionId: string) => Promise<PartnerShare[]>;
  /** My own P&L (calculate_pnl RPC) for an arbitrary (past or current) session. */
  fetchSessionPnl: (sessionId: string) => Promise<{ pnl?: AdminPnl; error?: string }>;
  /** Confirmed "Share to Partners" history for an arbitrary (past or current) session. */
  fetchSessionShareHistory: (sessionId: string) => Promise<ShareHistoryEntry[]>;
}

export const AppContext = createContext<AppCtx>({} as AppCtx);
export const useApp = () => useContext(AppContext);
