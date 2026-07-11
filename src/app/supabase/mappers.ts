// DB row <-> UI type mapping. Keeps the snake_case/uuid reality of Postgres
// out of the component layer, which speaks the existing camelCase types in
// ../types.ts.
import type {
  Role, Session, UserAccount, PartnerAccount, AdminAccount, BetEntry, LimitRow, PartnerShare, WarningMessage,
} from '../types';

export type DbRole = 'master_admin' | 'admin' | 'user' | 'partner';

export function dbRoleToUiRole(role: DbRole): Role {
  return role === 'master_admin' ? 'masterAdmin' : (role as Role);
}

export interface AccountRow {
  id: string;
  auth_user_id: string | null;
  role: DbRole;
  username: string;
  email: string | null;
  commission_rate: number;
  payout_rate: number;
  data_share_percentage: number | null;
  created_by: string | null;
  is_active: boolean;
  created_at: string;
  data_entry_open?: boolean;
  sub_limit_value?: number | null;
}

export function accountRowToUser(row: AccountRow): UserAccount {
  return {
    id: row.id,
    username: row.username,
    commissionRate: Number(row.commission_rate),
    payoutRate: Number(row.payout_rate),
    isActive: row.is_active,
    dataEntryOpen: row.data_entry_open ?? true,
  };
}

export function accountRowToPartner(row: AccountRow): PartnerAccount {
  return {
    id: row.id,
    username: row.username,
    commissionRate: Number(row.commission_rate),
    payoutRate: Number(row.payout_rate),
    sharePercentage: Number(row.data_share_percentage ?? 0),
    isActive: row.is_active,
    subLimitValue: row.sub_limit_value ?? null,
  };
}

export function accountRowToAdmin(row: AccountRow): AdminAccount {
  return {
    id: row.id,
    username: row.username,
    commissionRate: Number(row.commission_rate),
    payoutRate: Number(row.payout_rate),
    isActive: row.is_active,
  };
}

export interface SessionRow {
  id: string;
  label: string;
  status: 'open' | 'closed';
  opened_at: string;
  closed_at: string | null;
  winning_number: string | null;
  share_method: 'percentage' | 'equally' | null;
  total_data_set_limit: number | null;
  auto_close_at?: string | null;
  entry_hold_until?: string | null;
}

export function sessionRowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    label: row.label,
    status: row.status,
    openedAt: row.opened_at,
    closedAt: row.closed_at ?? undefined,
    winningNumber: row.winning_number,
    shareMethod: row.share_method ?? 'percentage',
    autoCloseAt: row.auto_close_at ?? null,
    totalDataSetLimit: row.total_data_set_limit ?? null,
    entryHoldUntil: row.entry_hold_until ?? null,
  };
}

export function makeSessionLabel(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const period = date.getHours() < 12 ? 'AM' : 'PM';
  return `${dd}-${mm}-${yyyy} (${period})`;
}

export interface BetEntryRow {
  id: string;
  session_id: string;
  user_id: string;
  number: string;
  amount: number;
  created_at: string;
}

export function betEntryRowToBetEntry(row: BetEntryRow): BetEntry {
  return {
    id: row.id,
    userId: row.user_id,
    number: row.number,
    amount: row.amount,
    timestamp: row.created_at,
  };
}

export interface EntryLimitRow {
  session_id: string;
  user_id: string;
  number: string;
  limit_value: number;
}

/**
 * The existing UI treats the limit table as ONE flat set of 100 rows shared
 * by every user (this simplification predates this wiring pass — the
 * original mock's EntryLimits screen never actually assigned different
 * limits per user). We honor that by de-duplicating per number, keeping
 * whichever row we see first, rather than exposing a per-user table in the
 * UI. All write paths (setLimitsDefault/setLimitRow) fan the same value out
 * to every managed user's row so this stays true.
 */
export function entryLimitRowsToLimitTable(rows: EntryLimitRow[]): LimitRow[] {
  const byNumber = new Map<string, number>();
  for (const r of rows) {
    if (!byNumber.has(r.number)) byNumber.set(r.number, r.limit_value);
  }
  const table: LimitRow[] = [];
  for (let i = 0; i < 100; i++) {
    const num = String(i).padStart(2, '0');
    table.push({ number: num, limit: byNumber.get(num) ?? 0 });
  }
  return table;
}

export interface PartnerShareRow {
  id: string;
  session_id: string;
  partner_id: string;
  number: string;
  shared_amount: number;
}

export function partnerShareRowToPartnerShare(row: PartnerShareRow): PartnerShare {
  return {
    partnerId: row.partner_id,
    number: row.number,
    sharedAmount: row.shared_amount,
  };
}

export interface WarningMessageRow {
  id: string;
  session_id: string;
  message: string;
  audience_role: 'user' | 'partner';
  audience_scope: 'all' | 'selected';
  is_active: boolean;
  created_by: string;
  created_at: string;
}

/**
 * A single "send to all (users + partners)" action creates TWO rows server
 * side (one per audience_role, since the DB ties one message to one
 * audience_role — see supabase/api.ts sendWarning). Each row is surfaced as
 * its own list entry here rather than heuristically re-merged, which would
 * be fragile. targetRole is therefore always 'users' | 'partners' coming
 * out of the DB, never 'all'.
 */
export function warningRowToWarningMessage(row: WarningMessageRow): WarningMessage {
  return {
    id: row.id,
    message: row.message,
    targetRole: row.audience_role === 'user' ? 'users' : 'partners',
    dismissedBy: [],
    createdAt: row.created_at,
  };
}
