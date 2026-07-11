# Treasure — Project Specification
**Version:** 1.2 (Phase 1)
**Last Updated:** 2026-07-06
**Platform:** Web App (Phase 1) → Mobile App (Phase 2)
**Backend:** Supabase (PostgreSQL + Auth + Edge Functions + Realtime)

---

## 1. Overview

Treasure is a 2D lottery data management platform for a lottery business operator. It connects three tiers of users — Admin, Users (agents/bettors), and Partners — through a shared session-based data flow:

1. **Users** enter bet data during an open session.
2. **Admin** monitors totals, enforces per-number limits, and decides which over-limit data to offload.
3. **Partners** receive the over-limit excess from Admin and manage their own sub-limits.
4. A **winning number** set by Admin triggers P&L calculations for all parties independently, each paying out from their own held data.

**Phase 1** covers 2D (numbers 00–99) only.
**Phase 2** will add a 3D session layer (000–999) after Phase 1 is complete.

---

## 2. Roles & Account Structure

### 2.1 Role Hierarchy

```
Master Admin
  └── Admin Accounts (created by Master Admin)
        ├── User Accounts (managed by Admin)
        └── Partner Accounts (managed by Admin)
```

### 2.2 Account Types

| Role | Login ID | Email Required | Email Verification | Created By |
|---|---|---|---|---|
| Master Admin | Username + Password | **Yes** | **Required** | System (seeded) |
| Admin | Username + Password | No | None | Master Admin |
| User | Username + Password | No | None | Admin |
| Partner | Username + Password | No | None | Admin |

- **Master Admin** requires a valid email address and must complete email verification before the account is activated. A verification link is sent to the registered email on account creation.
- Admin, User, and Partner accounts use username-only login — no email, no 2FA, no OAuth.
- All non-Master-Admin account IDs are plain alphanumeric usernames.
- Master Admin is the only seeded account; all others are created in-app.

---

## 3. Data Model (Phase 1 — 2D)

### 3.1 Core Entities

**Sessions**
- One active session at a time (system-wide).
- Fields: `id`, `created_by` (admin), `status` (open/closed), `opened_at`, `closed_at`, `winning_number` (00–99 or null), `share_method` (percentage | equally).

**Users / Partners**
- Fields: `id`, `username`, `hashed_password`, `role`, `commission_rate` (%), `payout_rate` (multiplier), `created_by` (admin id), `is_active`.
- For Partners only: additionally `data_share_percentage` (used when share method = percentage).

**Entry Limit Table** (per user, per session)
- 100 rows, one per number (00–99).
- Fields: `user_id`, `session_id`, `number` (00–99), `limit_value`.
- Admin assigns a limit table to one or many users at once.
- A user can only submit a bet for number `N` up to `limit_value[N]` total across all their entries in the session.

**Bet Entries**
- Fields: `id`, `session_id`, `user_id`, `number` (00–99), `amount`, `created_at`.
- On submission, the system checks cumulative amount for that `user_id + session_id + number` against the limit. If exceeded, the entry is blocked with an error message.

**Total Data View** (computed, not stored)
- Aggregates all bet entries per number across selected users for a session.
- Formula per number: `SUM(amount)` across selected users.

**Over Limit Table** (per session, stored after admin action)
- Fields: `session_id`, `number`, `total_amount`, `limit_value`, `over_limit_amount`.
- `over_limit_amount = MAX(0, total_amount - limit_value)`.
- Only rows where `over_limit_amount > 0` are shown.

**Partner Share Records**
- Fields: `session_id`, `partner_id`, `number`, `shared_amount`, `share_method` (percentage | equally).
- Created when admin distributes over-limit data to partners.

**Winning Number**
- Stored on the Session record.
- Global — affects all accounts simultaneously.
- Triggers P&L calculations for admin and each partner independently.

---

## 4. Business Logic

### 4.1 Commission

- Commission is a **discount on gross bet intake** for each user and partner.
- `Net intake = Gross intake × (1 − commission_rate / 100)`
- Admin's effective revenue from a user is the net intake (after commission deduction).
- Commission rate is set per user and per partner independently by Admin.

### 4.2 Payout

- Payout rate is a **whole-number multiplier** (e.g. 80× for 2D).
- `Payout = winning_number_total_held × payout_rate`
- Each party (Admin, each Partner) pays out only from their own held data for the winning number.

### 4.3 P&L Formula

For each party independently:

```
Gross Intake       = SUM(all bet amounts held by this party)
Commission Discount = Gross Intake × commission_rate / 100
Net Intake         = Gross Intake − Commission Discount
Payout             = Amount held on winning number × payout_rate
Net P&L            = Net Intake − Payout
```

Admin's "held data" = Total Data − Over Limit amounts shared to partners.
Partner's "held data" = amounts received from admin via share records.

### 4.4 Over-Limit Sharing

Admin selects a **share method per session** before distributing:

**Method A — By Percentage:**
- Each partner has a pre-set `data_share_percentage`.
- All active partners' percentages must sum to 100%.
- Each partner receives: `over_limit_amount[N] × partner_share_percentage / 100` per number.

**Method B — Equally:**
- Over-limit amount for each number is divided equally among all selected partners.
- `partner_share[N] = over_limit_amount[N] / number_of_selected_partners` (rounded to whole number; remainder stays with admin).

### 4.5 Entry Limit Enforcement

- When a user submits a bet for number `N` with amount `A`:
  - System checks: `existing_total[user][session][N] + A ≤ limit_value[N]`
  - If exceeded: **block the entry, show an error** ("Limit exceeded for number XX. Remaining: YYY").
  - If within limit: entry is saved.

---

## 5. Feature Specification by Role

---

### 5.1 Master Admin

Master Admin is a superuser with all Admin capabilities plus:

- Create / Edit / Delete Admin accounts.
- View all Admins and their associated users and partners.
- No separate dashboard — uses the same Admin dashboard scoped to all data.

---

### 5.2 Admin Account

#### 5.2.1 Dashboard

Displays summary statistics for the current or most recent session:

| Metric | Description |
|---|---|
| Total Users | Count of active user accounts |
| Total Partners | Count of active partner accounts |
| Total User Amount | Gross bet intake from all users this session |
| Total Over Limit Amount | Sum of all over-limit excess across all numbers |
| Profit & Loss | Net P&L for Admin after commission, payouts (post winning number) |

#### 5.2.2 Account Management

**Users:**
- Create User: username, password, commission rate (%), payout rate (multiplier).
- Edit User: any field above.
- Delete User: soft delete (deactivate); historical data retained.
- View User list with filter/search.

**Partners:**
- Create Partner: username, password, commission rate (%), payout rate (multiplier), data share percentage (for percentage-based sharing).
- Edit Partner: any field above.
- Delete Partner: soft delete.
- View Partner list with filter/search.
- Validation: when share method = percentage, sum of all active partners' `data_share_percentage` must equal 100% before session distribution is allowed.

#### 5.2.3 Session Management

**Session Controls:**
- **Open Session** button — opens a new session (blocked if one is already active).
- **Close Session** button — closes the active session. Requires confirmation. After close, data entry is disabled for all users.
- Session open/close time is recorded automatically.

**Warning Messages:**
- Compose and send a warning message to:
  - All users (default), or select specific users.
  - All partners (default), or select specific partners.
- Messages appear as a visible banner/notification in the recipient's account until dismissed or session closes.

#### 5.2.4 Entry Data Limit Management

**Limit Table:**
- A 100-row table (00–99), each row: `Number | Limit Value`.
- Admin can edit limit values inline.
- **Set Default Value** button:
  - Admin types a single number into an input field and clicks "Set Default".
  - All 100 rows (00–99) are immediately filled with that value.
  - Admin can then individually override specific rows before assigning.
- **Assign Limit Table** button:
  - Default: assign to all users.
  - Option: select specific users to assign different limit values.
- Multiple limit table profiles can be saved and re-applied.

#### 5.2.5 Total Data Management

**Left Panel — Total Data Table:**
- Displays aggregated bet totals per number (00–99): `Number | Total Amount`.
- Filter by: All Users (default) or checkbox-select specific users.
- Shows: Total Amount (sum of all rows).
- Sortable: Index ascending, Value descending (both available as sort options).
- **Set Limit** input (adjustable): admin sets a global cutoff threshold for the current view. Numbers exceeding this limit are flagged.

**Right Panel — Over Limit Table:**
- Displays only numbers where `total_amount > set_limit`: `Number | Over Limit Amount`.
- `Over Limit Amount = total_amount − set_limit` per number.
- Shows: Total Over Limit Amount.
- Sortable: Index ascending, Value descending.
- **Share to Partners** button:
  - Admin selects share method (Percentage / Equally) — this sets the session's share method.
  - Confirmation dialog showing breakdown per partner before confirming.
  - On confirm: creates Partner Share Records and updates partner data views.

#### 5.2.6 Winning Number

- A single input field: enter the winning number (00–99).
- Confirmation required before saving.
- Once set, it is **global** — immediately visible and applied to all account types.
- Triggers P&L recalculation for Admin and all Partners.
- Can only be set once per session (editable only before session close, with re-confirmation).

#### 5.2.7 Reports

Admin report for the current session, copyable as plain text:

```
Session Report — [Session ID] — [Date]
Winning Number: XX
---------------------------------------
Number | Total Bets | Over Limit | Shared to Partners
00     | 5,000      | 2,000      | 2,000
01     | 1,000      | 0          | 0
...
---------------------------------------
Gross Intake:        XXX,XXX
Commission Total:    XX,XXX
Net Intake:          XXX,XXX
Payout (Win No. XX): XX,XXX
Net P&L:             XXX,XXX
```

- Copyable via a "Copy" button (copies plain text to clipboard).
- Filterable by user selection (same as Total Data view).

---

### 5.3 User Account

#### 5.3.1 Profile

Displays read-only info:
- Username
- Commission Rate
- Payout Rate

#### 5.3.2 Session Status

- Prominent status indicator: **OPEN** (green) / **CLOSED** (red).
- When closed: data entry is disabled; a "Session is closed" message is shown.

#### 5.3.3 Warning Messages

- If Admin has sent a warning, it appears as a dismissible banner at the top of the screen.

#### 5.3.4 Data Entry

- Available only when session is OPEN.
- **Bulk Entry Mode** (primary input method):
  - Text area accepting multi-line input. Each line represents one or more bets.
  - **All of the following formats are valid and can be mixed in the same text area:**

    | Format | Example | Behaviour |
    |---|---|---|
    | `number = amount` (equals, standard) | `46 = 500` | Enters 46 = 500 |
    | `number amount` (space) | `46 500` | Enters 46 = 500 |
    | `numberRamount` (R-format) | `46R1000` | Enters **both** 46 = 1000 **and** 64 = 1000 (number + its digit-reverse) |
    | `number-amount` (dash, no spaces) | `58-300` | Enters 58 = 300 |
    | `number - amount` (dash, with spaces) | `87 - 2000` | Enters 87 = 2000 |
    | `number=amount` (equals, no spaces) | `47=300` | Enters 47 = 300 |

  - **R-format rule:** R-format always generates two entries — one for the number and one for its digit-reverse:
    - Different digits: `46R1000` → `46 = 1000` and `64 = 1000` (two separate entries).
    - Same digits: `55R500` → `55 = 1000` (reverse is the same number, so amounts stack: 500 + 500 = 1000, stored as a single entry).
  - Mixed example input:
    ```
    46 = 500
    46R1000
    58-300
    87 - 2000
    47=300
    05 500
    55R500
    ```
  - On submit, the system parses and validates each line:
    - Number must be 00–99 (after R-format expansion, both numbers are validated separately).
    - Amount must be a positive integer.
    - Amount must not exceed the remaining limit for that number.
  - Lines that pass are saved; lines that fail are shown with individual error messages indicating the line, the issue, and the remaining allowance.
  - User can correct and resubmit failed lines without re-entering successful ones.
- **Single Entry Mode** (secondary):
  - Number selector (00–99) + amount input field.
  - Submit button.
  - Immediate inline error if limit exceeded.
- Entry history for the current session shown below the entry form (number, amount, timestamp).

#### 5.3.5 Invoices

Per-session invoice for the user, copyable as plain text:

```
Invoice — [Username] — [Session ID] — [Date]
Winning Number: XX
---------------------------------------
Number | Amount Bet
05     | 500
12     | 300
07     | 1,000
...
---------------------------------------
Gross Bet Total:    X,XXX
Commission (X%):    XXX
Net Payable:        X,XXX
Payout (Win No. XX):X,XXX
Net P&L:            X,XXX
```

- "Copy" button for plain text clipboard copy.

#### 5.3.6 Reports

Same structure as invoice but aggregated over multiple sessions (date range selectable).

---

### 5.4 Partner Account

#### 5.4.1 Profile

Displays read-only info:
- Username
- Commission Rate
- Payout Rate
- Data Share Percentage (if percentage method is in use)

#### 5.4.2 Session Status

- Same as User: OPEN / CLOSED indicator.

#### 5.4.3 Warning Messages

- Displays any Admin warning messages sent to partners.

#### 5.4.4 Data Management

**Left Panel — Received Data Table:**
- Displays data shared from Admin: `Number | Shared Amount`.
- Only numbers with `shared_amount > 0` shown.
- Total Amount shown below table.
- **Set Limit** input (adjustable by partner): partner sets their own sub-limit threshold.
- Sortable: Index ascending, Value descending.

**Right Panel — Over Limit Table:**
- Numbers where `shared_amount > partner_set_limit`: `Number | Over Limit Amount`.
- `Over Limit Amount = shared_amount − partner_set_limit`.
- Total Over Limit Amount shown.
- **Copy Table** button: copies the over-limit table as plain text to clipboard.
- Sortable: Index ascending, Value descending.

#### 5.4.5 Reports

Per-session partner report, copyable as plain text:

```
Partner Report — [Username] — [Session ID] — [Date]
Winning Number: XX
---------------------------------------
Number | Received | Over Limit
05     | 500      | 0
12     | 2,000    | 500
...
---------------------------------------
Gross Received:      X,XXX
Commission (X%):     XXX
Net Intake:          X,XXX
Payout (Win No. XX): X,XXX
Net P&L:             X,XXX
```

- "Copy" button for plain text clipboard copy.

---

## 6. UI / UX Requirements

### 6.1 General

- **Language:** English only.
- **Color Theme:** Gold / Blue / Black (luxury/premium aesthetic).
- **Responsive:** Web-first; mobile-responsive layout for Phase 1.
- **No 2FA**. Email is required only for Master Admin (verification on account creation); all other roles are email-free.

### 6.2 Tables — Universal Sorting Rules

All data tables (Total Data, Over Limit, Partner Received, etc.) must support:
- Sort by **Index: Ascending** (00 → 99) — default.
- Sort by **Value: Descending** (highest amount first).
- Toggle between the two with a visible sort control.

### 6.3 Copy-to-Text

All reports and invoices include a **Copy** button that:
- Copies plain-text formatted content to the system clipboard.
- Shows a brief "Copied!" confirmation toast.
- Plain text format is human-readable and suitable for pasting into messaging apps (Telegram, Viber, etc.).

### 6.4 Error Handling

- Bet entry over limit: inline error per number with remaining allowance shown.
- Session already open: block open session action with message.
- Partner share percentages not summing to 100%: block distribution with validation message.
- All destructive actions (delete account, close session, set winning number): require a confirmation modal.

---

## 7. Backend Architecture (Supabase)

### 7.1 Database Tables

| Table | Purpose |
|---|---|
| `accounts` | All users (master_admin, admin, user, partner) |
| `sessions` | Session records with status, winning number, share method |
| `entry_limits` | Per-user per-session per-number entry limits |
| `bet_entries` | Individual bet submissions by users |
| `over_limit_records` | Computed over-limit amounts per number per session |
| `partner_shares` | Records of shared data per partner per number per session |
| `warning_messages` | Messages sent by admin to users/partners |
| `session_targets` | Links sessions to specific users/partners for targeted open/close/messages |

### 7.2 Row-Level Security (RLS)

- Users can only read/write their own bet entries.
- Partners can only read their own share records.
- Admins can read/write all records scoped to their managed accounts.
- Master Admin has unrestricted access.

### 7.3 Edge Functions

| Function | Purpose |
|---|---|
| `create-account` | Provisions user/partner accounts with hashed passwords |
| `distribute-over-limit` | Calculates and writes partner share records based on selected method |
| `calculate-pnl` | Triggered after winning number is set; computes P&L for admin and all partners |
| `validate-bet-entry` | Server-side limit check before saving a bet entry |

### 7.4 Realtime Subscriptions

- Session status (open/close) — all connected clients update instantly.
- Warning messages — push to target users/partners immediately.
- Winning number — broadcast to all clients when set.

---

## 8. Phased Delivery Plan

### Phase 1 — 2D Web App

| # | Module | Deliverables |
|---|---|---|
| 1 | Auth & Accounts | Login, Master Admin seed, account CRUD |
| 2 | Session Management | Open/close session, warning messages |
| 3 | User Data Entry | Bulk entry, limit enforcement, entry history |
| 4 | Admin Total Data | Aggregated view, set limit, over-limit computation |
| 5 | Partner Distribution | Share over-limit (% and equally), partner data view |
| 6 | Winning Number & P&L | Set winning number, P&L calculation, dashboard |
| 7 | Reports & Invoices | Copyable text reports for all roles |
| 8 | Polish & Testing | RLS audit, edge case handling, responsive QA |

### Phase 2 — 3D Session + Mobile App

- Add a parallel 3D session layer (numbers 000–999) with independent entry limits, totals, over-limit logic, and P&L.
- Native mobile app (iOS + Android) using the same Supabase backend.
- 3D payout rate: 550× (to be confirmed).

---

## 9. Out of Scope (Phase 1)

- Email notifications / SMS (email is used only for Master Admin verification, not for notifications or password reset flows).
- Two-factor authentication.
- Payment processing or wallet features.
- Automated session scheduling.
- Audit logs / change history UI (backend logging retained).
- Multi-language support.
- Dark/light mode toggle (fixed Gold/Blue/Black theme).

---

## 10. Open Questions for Future Clarification

| # | Question |
|---|---|
| 1 | Should past sessions be archived and browsable, or only the most recent session is accessible? |
| 2 | Can Admin edit or delete individual bet entries submitted by users, or are entries immutable once saved? |
| 3 | Is there a cap on how many users or partners an Admin can manage? |
| 4 | For equally-split sharing, should remainders from rounding go to Admin or be flagged? |
| 5 | Should Partner accounts be able to further share their over-limit data downstream (sub-partners), or is the chain Admin → Partner final? |

---

*End of Specification — Treasure v1.2 (Phase 1)*
