import { useState, useMemo, useEffect, useRef } from 'react';
import { LogOut, Bell, X, AlertCircle, Copy, CheckCheck, ClipboardList, History, Receipt, CalendarClock, ClipboardPaste, Trash2, Scissors } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '../context';
import { C } from '../theme';
import type { BetEntry, AdminPnl } from '../types';
import { formatIndexValueLines, formatPayoutDetail } from '../utils/format';
import { useCountdownMs, formatCountdown } from '../utils/countdown';

type Tab = 'entry' | 'history' | 'invoice';
type EntryMode = 'bulk' | 'keyboard';

// Keyboard Entry's 8 pattern tabs. Labels are the exact Burmese terms the
// user specified — no English translations. All 8 rules were confirmed
// directly by the user (အပါ/ပါဝါ/နက္ခတ်/ခွေ/အပူး) or verified frame-by-frame
// against the reference recording (ထိပ်/နောက်/ဘရိတ်), and are fully live.
type KbTabId = 'apar' | 'head' | 'tail' | 'power' | 'break' | 'nekkhat' | 'kwe' | 'twin';
type KbMode = KbTabId | 'reverse' | null;
const KB_TABS: { id: KbTabId; label: string }[] = [
  { id: 'apar', label: 'အပါ' },
  { id: 'head', label: 'ထိပ်' },
  { id: 'tail', label: 'နောက်' },
  { id: 'power', label: 'ပါဝါ' },
  { id: 'break', label: 'ဘရိတ်' },
  { id: 'nekkhat', label: 'နက္ခတ်' },
  { id: 'kwe', label: 'ခွေ' },
  { id: 'twin', label: 'အပူး' },
];

// ပါဝါ, နက္ခတ်, and အပူး are fixed 10-number lists — no digit input needed,
// just an amount. Confirmed exactly by the user.
const KB_FIXED_LIST_MODES: KbTabId[] = ['power', 'nekkhat', 'twin'];
const POWER_NUMBERS = ['05', '16', '27', '38', '49', '50', '61', '72', '83', '94'];
const NEKKHAT_NUMBERS = ['07', '18', '24', '35', '42', '53', '69', '70', '81', '96'];
const TWIN_NUMBERS = ['00', '11', '22', '33', '44', '55', '66', '77', '88', '99'];

/** Generates the entries a Keyboard Entry ENTER/OK press should add, given
 * the active mode, the typed number, and the amount. Mirrors the exact
 * rules confirmed by the user:
 *  - 'reverse' (R key): a 2-digit number + its digit-reversed counterpart,
 *    both at `amount` (or one entry at double amount for a palindrome like
 *    55) — same convention as the "46R1000" bulk-entry format.
 *  - 'head' (ထိပ်): single digit D -> the 10 numbers D0..D9.
 *  - 'tail' (နောက်): single digit D -> the 10 numbers 0D..9D.
 *  - 'break' (ဘရိတ်): single digit D -> the 10 numbers whose digits sum to D mod 10.
 *  - 'apar' (အပါ): single digit D -> all numbers where D is the tens digit
 *    OR the units digit (union, deduped — 19 numbers for any digit).
 *  - 'power' (ပါဝါ), 'nekkhat' (နက္ခတ်), 'twin' (အပူး): fixed 10-number
 *    lists, no digit input required.
 *  - 'kwe' (ခွေ): multi-digit seed (3+ digits) -> every ordered pair of
 *    distinct digit positions, walked in original input order, as a
 *    2-digit number (e.g. "123" -> 12,13,21,23,31,32).
 *  - default (straight): one or more "/"-separated 1-2 digit numbers, all
 *    at the same amount (e.g. "12/34/56" -> three entries).
 */
function computeKbEntries(
  mode: KbMode, rawNumber: string, amount: number
): { number: string; amount: number }[] | { error: string } {
  const trimmed = rawNumber.trim();

  if (mode === 'power') return POWER_NUMBERS.map(number => ({ number, amount }));
  if (mode === 'nekkhat') return NEKKHAT_NUMBERS.map(number => ({ number, amount }));
  if (mode === 'twin') return TWIN_NUMBERS.map(number => ({ number, amount }));

  if (mode === 'reverse') {
    if (!/^\d{1,2}$/.test(trimmed)) return { error: 'Type a 2-digit number first' };
    const num = trimmed.padStart(2, '0');
    const rev = num[1] + num[0];
    if (num === rev) return [{ number: num, amount: amount * 2 }];
    return [{ number: num, amount }, { number: rev, amount }];
  }
  if (mode === 'head' || mode === 'tail' || mode === 'break') {
    if (!/^\d$/.test(trimmed)) return { error: 'Enter a single digit (0–9)' };
    const d = parseInt(trimmed, 10);
    const out: { number: string; amount: number }[] = [];
    for (let i = 0; i < 10; i++) {
      const number = mode === 'head' ? `${d}${i}` : mode === 'tail' ? `${i}${d}` : `${i}${(((d - i) % 10) + 10) % 10}`;
      out.push({ number, amount });
    }
    return out;
  }
  if (mode === 'apar') {
    if (!/^\d$/.test(trimmed)) return { error: 'Enter a single digit (0–9)' };
    const out: { number: string; amount: number }[] = [];
    for (let i = 0; i < 10; i++) out.push({ number: `${trimmed}${i}`, amount }); // tens digit = D
    for (let i = 0; i < 10; i++) if (String(i) !== trimmed) out.push({ number: `${i}${trimmed}`, amount }); // units digit = D
    out.sort((a, b) => a.number.localeCompare(b.number));
    return out;
  }
  if (mode === 'kwe') {
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length < 2) return { error: 'Type at least 2 digits' };
    const out: { number: string; amount: number }[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < digits.length; i++) {
      for (let j = 0; j < digits.length; j++) {
        if (i === j) continue;
        const number = digits[i] + digits[j];
        if (!seen.has(number)) { seen.add(number); out.push({ number, amount }); }
      }
    }
    return out;
  }
  // Straight (default, no tab selected) — supports "/"-separated numbers
  // all at the same amount, matching the recording's "/" key.
  const tokens = trimmed.split('/').map(t => t.trim()).filter(Boolean);
  if (tokens.length === 0) return { error: 'Enter a number' };
  const out: { number: string; amount: number }[] = [];
  for (const t of tokens) {
    if (!/^\d{1,2}$/.test(t) || parseInt(t, 10) > 99) return { error: `Invalid number "${t}"` };
    out.push({ number: t.padStart(2, '0'), amount });
  }
  return out;
}

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'entry', label: 'Data Entry', icon: ClipboardList },
  { id: 'history', label: 'History', icon: History },
  { id: 'invoice', label: 'Invoice', icon: Receipt },
];

interface ParsedLine {
  raw: string;
  entries: { number: string; amount: number }[];
  error?: string;
}

function parseLine(line: string): { number: string; amount: number }[] | null {
  const t = line.trim();
  if (!t) return [];
  // R-format
  const rMatch = t.match(/^(\d{1,2})[Rr](\d+)$/);
  if (rMatch) {
    const num = rMatch[1].padStart(2, '0');
    const amount = parseInt(rMatch[2]);
    if (parseInt(num) > 99 || amount < 0) return null;
    const rev = num[1] + num[0];
    if (num === rev) return [{ number: num, amount: amount * 2 }];
    return [{ number: num, amount }, { number: rev, amount }];
  }
  const m = t.match(/^(\d{1,2})\s*[=\-]\s*(\d+)$/) || t.match(/^(\d{1,2})\s+(\d+)$/);
  if (m) {
    const num = m[1].padStart(2, '0');
    const amount = parseInt(m[2]);
    if (parseInt(num) > 99 || amount < 0) return null;
    return [{ number: num, amount }];
  }
  return null;
}

// Lines that are clearly metadata pasted alongside real bet data — a date
// header, a time stamp, a "Total"/"Total Amount"/"Grand Total" summary line
// from whatever chat or notebook the numbers were copied out of — rather
// than an actual number=amount line. These are silently skipped during
// parsing: never shown as invalid, never submitted, so a whole pasted
// message doesn't need to be hand-trimmed down to just the bet lines first.
// Bet-line format never uses "/", ":", or the word "total", so there's no
// realistic collision with a real entry.
function isIgnorableBulkLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/\btotal\b/i.test(t)) return true; // Total / Total Amount / Grand Total
  if (/^(date|time|amount)\b\s*[:\-]?/i.test(t)) return true; // "Date: ...", "Time - ..."
  if (/^\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}(\s+\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?)?$/i.test(t)) return true; // 22/07/2026, 2026-07-22, with optional trailing time
  if (/^\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?$/i.test(t)) return true; // bare time, e.g. 12:30 PM
  return false;
}

const BULK_PLACEHOLDER = `46 = 500
07R1000
58-300
87 - 2000
47=300
05 500
55R500`;

// Draft persistence — mobile browsers/PWAs routinely reload the whole page
// after the app has been backgrounded for a while (switching to another
// app and back), which wipes plain React state with no chance for an
// unmount handler to run. Bulk Entry's text and Keyboard Entry's pending
// list + in-progress number/amount/mode are mirrored to localStorage per
// user, keyed so one account's draft never leaks into another's, and
// restored on mount — so a background-reload no longer loses unsubmitted
// work. This is a nice-to-have, not a correctness requirement, so every
// read/write is wrapped and fails silently if storage is unavailable.
function readDraft<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeDraft(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked (e.g. private browsing) — non-fatal.
  }
}
function clearDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Non-fatal.
  }
}

type KbDraft = {
  number: string;
  amount: string;
  mode: KbMode;
  activeField: 'number' | 'amount';
  pending: { number: string; amount: number }[];
};
const KB_DRAFT_EMPTY: KbDraft = { number: '', amount: '', mode: null, activeField: 'number', pending: [] };

export function UserLayout() {
  const {
    logout, currentUserId, session, betEntries, limitTable, users, warnings, submitBetEntries,
    allSessions, fetchSessionBetEntries, fetchSessionPnl,
  } = useApp();
  const [tab, setTab] = useState<Tab>('entry');
  const [mode, setMode] = useState<EntryMode>('bulk');

  // Draft storage keys are per-user so switching accounts on the same
  // device never shows one user's unsubmitted draft to another.
  const bulkDraftKey = `treasure_bulk_draft_${currentUserId}`;
  const kbDraftKey = `treasure_kb_draft_${currentUserId}`;

  const [bulkText, setBulkText] = useState(() => readDraft(bulkDraftKey, ''));
  const [parsed, setParsed] = useState<ParsedLine[] | null>(null);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);

  useEffect(() => {
    if (bulkText) writeDraft(bulkDraftKey, bulkText);
    else clearDraft(bulkDraftKey);
  }, [bulkText, bulkDraftKey]);

  // --- Keyboard Entry ---
  const [kbNumber, setKbNumber] = useState(() => readDraft(kbDraftKey, KB_DRAFT_EMPTY).number);
  const [kbAmount, setKbAmount] = useState(() => readDraft(kbDraftKey, KB_DRAFT_EMPTY).amount);
  const [kbActiveField, setKbActiveField] = useState<'number' | 'amount'>(() => readDraft(kbDraftKey, KB_DRAFT_EMPTY).activeField);
  const [kbMode, setKbMode] = useState<KbMode>(() => readDraft(kbDraftKey, KB_DRAFT_EMPTY).mode);
  const [kbPending, setKbPending] = useState<{ number: string; amount: number }[]>(() => readDraft(kbDraftKey, KB_DRAFT_EMPTY).pending);
  const [kbShowConfirm, setKbShowConfirm] = useState(false);
  // True right after focus auto-jumps (or the user taps) into Amount while
  // it already holds a leftover value from a previous entry — the next
  // digit tap then replaces that value outright instead of appending to
  // it, mirroring a text input landing with its content selected. Cleared
  // the moment that replacement happens, so digits after the first append
  // normally.
  const [kbAmountSelected, setKbAmountSelected] = useState(false);

  useEffect(() => {
    const isEmpty = kbPending.length === 0 && !kbNumber && !kbAmount && kbMode === null;
    if (isEmpty) {
      clearDraft(kbDraftKey);
    } else {
      const draft: KbDraft = { number: kbNumber, amount: kbAmount, mode: kbMode, activeField: kbActiveField, pending: kbPending };
      writeDraft(kbDraftKey, draft);
    }
  }, [kbNumber, kbAmount, kbMode, kbActiveField, kbPending, kbDraftKey]);
  // Computed once when Submit is pressed (kbOpenConfirm) — splits everything
  // gathered so far into what's within the entry limit and what isn't, so
  // the confirm modal can show exactly why an entry won't go through before
  // the user commits. Only `valid` gets submitted; `invalid` stays in the
  // pending list to edit and resubmit, same recovery pattern as Bulk Entry.
  const [kbConfirmInfo, setKbConfirmInfo] = useState<{
    valid: { number: string; amount: number }[];
    invalid: { number: string; amount: number; error: string }[];
  } | null>(null);

  // Keyboard Entry's bottom dock (Total, Number/Mode/Amount, pattern tabs,
  // keypad, Cancel/Submit) is position:fixed to the viewport so it's always
  // visible. Its real rendered height is measured here (fonts/line-heights
  // aren't worth hand-computing in pixels) so the scrollable content above
  // it can get exactly enough bottom padding to never sit underneath it.
  const kbDockRef = useRef<HTMLDivElement | null>(null);
  const [kbDockHeight, setKbDockHeight] = useState(0);

  useEffect(() => {
    const el = kbDockRef.current;
    if (!el) { setKbDockHeight(0); return; }
    const measure = () => setKbDockHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, kbMode]);

  const [dismissedWarnings, setDismissedWarnings] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  // '' means "current session" — the History tab defaults to the live
  // session's entries (from context, no extra fetch), and only fetches a
  // past session's data on demand when the user actually picks one by name.
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [historicalEntries, setHistoricalEntries] = useState<BetEntry[] | null>(null);
  const [historicalPnl, setHistoricalPnl] = useState<AdminPnl | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const viewingPastSession = selectedSessionId !== '' && selectedSessionId !== session.id;
  const viewedSession = viewingPastSession ? allSessions.find(s => s.id === selectedSessionId) : session;

  useEffect(() => {
    if (!viewingPastSession) { setHistoricalEntries(null); setHistoricalPnl(null); return; }
    let cancelled = false;
    setLoadingHistory(true);
    Promise.all([
      fetchSessionBetEntries(selectedSessionId),
      fetchSessionPnl(selectedSessionId),
    ]).then(([entries, { pnl }]) => {
      if (cancelled) return;
      setHistoricalEntries(entries.filter(e => e.userId === currentUserId));
      setHistoricalPnl(pnl ?? null);
      setLoadingHistory(false);
    });
    return () => { cancelled = true; };
  }, [viewingPastSession, selectedSessionId, currentUserId, fetchSessionBetEntries, fetchSessionPnl]);

  const user = users.find(u => u.id === currentUserId);
  const myEntries = betEntries.filter(e => e.userId === currentUserId);
  const viewedEntries = viewingPastSession ? (historicalEntries ?? []) : myEntries;

  // Groups Entry History by submission batch instead of one flat row per
  // number. There's no batch id column in bet_entries, but every row from a
  // single submitBetEntries call goes in inside one submit_bet_entries RPC
  // invocation, and Postgres's now() is transaction-stable (same value for
  // every insert in that one call) — so an exact-match on `timestamp`
  // reliably reconstructs "everything from one submit." Newest batch first.
  const historyBatches = useMemo(() => {
    const groups = new Map<string, BetEntry[]>();
    for (const e of viewedEntries) {
      const bucket = groups.get(e.timestamp);
      if (bucket) bucket.push(e);
      else groups.set(e.timestamp, [e]);
    }
    return Array.from(groups.entries())
      .map(([timestamp, entries]) => ({
        timestamp,
        entries,
        total: entries.reduce((s, e) => s + e.amount, 0),
      }))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [viewedEntries]);
  const isOpen = session.status === 'open';
  const remainingMs = useCountdownMs(isOpen ? session.autoCloseAt : null);
  // Admin can close just this user's entry (Account Management) without
  // closing the session for everyone else — treat that the same as the
  // session being closed for entry-submission purposes.
  const entryOpen = user ? user.dataEntryOpen : true;
  // Admin can also temporarily freeze entry for EVERYONE for a few minutes
  // (Session > Hold Session) without closing the session at all — self
  // clears once holdRemainingMs counts down past 0.
  const holdRemainingMs = useCountdownMs(isOpen ? session.entryHoldUntil : null);
  const held = holdRemainingMs !== null && holdRemainingMs > 0;
  const canEnter = isOpen && entryOpen && !held;

  const activeWarnings = warnings.filter(w =>
    !dismissedWarnings.includes(w.id) &&
    (w.targetRole === 'all' || w.targetRole === 'users')
  );

  const getTotals = (userId: string) => {
    const m: Record<string, number> = {};
    betEntries.filter(e => e.userId === userId).forEach(e => {
      m[e.number] = (m[e.number] || 0) + e.amount;
    });
    return m;
  };

  const parseBulk = () => {
    const lines = bulkText.split('\n');
    const totals = getTotals(currentUserId);
    const results: ParsedLine[] = [];

    for (const raw of lines) {
      if (!raw.trim()) continue;
      // Skip metadata lines silently — not a bet line, so not shown as
      // invalid either. Lets a whole pasted message (with a date header,
      // time stamp, or a "Total" summary line mixed in) go straight in.
      if (isIgnorableBulkLine(raw)) continue;
      const parsed = parseLine(raw);
      if (parsed === null) {
        results.push({ raw, entries: [], error: 'Invalid format' });
        continue;
      }
      const withLimits = parsed.map(e => {
        const lim = limitTable.find(r => r.number === e.number)?.limit ?? 0;
        const existing = totals[e.number] ?? 0;
        const remaining = lim - existing;
        if (e.amount > remaining) {
          return { ...e, error: `Limit exceeded for #${e.number}. Remaining: ${remaining.toLocaleString()}` };
        }
        return e;
      });
      const hasErr = withLimits.some((e: any) => e.error);
      results.push({ raw, entries: withLimits as any, error: hasErr ? withLimits.filter((e: any) => e.error).map((e: any) => e.error).join('; ') : undefined });
    }
    setParsed(results);
  };

  // Summary used both for the "N valid entries · Total: X" bar and to
  // gate/word the confirm-before-submit modal.
  const bulkStats = useMemo(() => {
    if (!parsed) return null;
    const validLines = parsed.filter(p => !p.error);
    const invalidLines = parsed.filter(p => p.error);
    const total = validLines.reduce((s, p) => s + p.entries.reduce((s2, e) => s2 + e.amount, 0), 0);
    return { validLines, invalidLines, total };
  }, [parsed]);

  const pasteBulk = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) { toast.error('Clipboard is empty'); return; }
      setBulkText(prev => (prev.trim() ? `${prev}\n${text}` : text));
      setParsed(null);
    } catch {
      toast.error('Could not read clipboard — check browser permissions');
    }
  };

  const clearBulk = () => {
    setBulkText('');
    setParsed(null);
  };

  // Drops only the invalid lines, leaving valid ones in the box to
  // re-parse/submit — distinct from Clear, which wipes everything.
  const clearInvalidBulk = () => {
    if (!bulkStats) return;
    setBulkText(bulkStats.validLines.map(p => p.raw).join('\n'));
    setParsed(bulkStats.validLines.length ? bulkStats.validLines : null);
    toast.success('Invalid lines cleared');
  };

  const submitBulk = async () => {
    if (!parsed) return;
    // Map each flat bet entry back to its index in the FULL `parsed` array
    // (not just the valid subset) so that after submission we can rebuild
    // bulkText from exactly the lines that still need attention. Format-
    // invalid lines are never included in `flat` / submitted at all, so
    // they must never be silently dropped from the box afterward.
    const flat: { number: string; amount: number }[] = [];
    const ownerIndex: number[] = [];
    parsed.forEach((p, idx) => {
      if (p.error) return;
      p.entries.forEach(e => { flat.push({ number: e.number, amount: e.amount }); ownerIndex.push(idx); });
    });

    if (!flat.length) { toast.error('No valid lines to submit'); setShowBulkConfirm(false); return; }

    const res = await submitBetEntries(flat);
    setShowBulkConfirm(false);
    if (res.error) { toast.error(res.error); return; }

    if (res.insertedCount > 0) {
      toast.success(`${res.insertedCount} bet${res.insertedCount !== 1 ? 's' : ''} submitted`);
    }

    const failedOriginalIndices = new Set<number>();
    res.results.forEach((r, i) => {
      if (r.status === 'error') failedOriginalIndices.add(ownerIndex[i]);
    });

    // Keep: lines that were format/limit-invalid to begin with, plus any
    // valid-looking lines the server itself rejected (attach its message).
    // Drop: lines that submitted successfully.
    const remaining = parsed
      .map((p, idx) => {
        if (!p.error && !failedOriginalIndices.has(idx)) return null;
        if (failedOriginalIndices.has(idx) && !p.error) {
          const errs = res.results
            .filter((r, i) => ownerIndex[i] === idx && r.status === 'error')
            .map(r => r.message)
            .filter(Boolean);
          return { ...p, error: errs.join('; ') || 'Rejected by server' };
        }
        return p;
      })
      .filter((p): p is ParsedLine => p !== null);

    if (failedOriginalIndices.size > 0) {
      toast.error(`${failedOriginalIndices.size} line${failedOriginalIndices.size !== 1 ? 's' : ''} rejected — see details below`);
    }

    setBulkText(remaining.map(p => p.raw).join('\n'));
    setParsed(remaining.length ? remaining : null);
  };

  // --- Keyboard Entry — numeric keypad + pattern tabs, matching the
  // reference recording's layout and (for the verified tabs) behavior. ---

  const kbAppend = (s: string) => {
    if (kbActiveField === 'number') {
      // Number is capped at 2 digits for every mode except ခွေ, which needs
      // a 3+ digit seed to generate its position-pair permutations.
      if (kbMode !== 'kwe') {
        setKbNumber(prev => (prev.length + s.length > 2 ? prev : prev + s));
      } else {
        setKbNumber(prev => prev + s);
      }
    } else if (kbAmountSelected) {
      // Amount was landed on with a leftover value "selected" — the first
      // digit replaces it outright, then behaves like a normal append.
      setKbAmount(s);
      setKbAmountSelected(false);
    } else {
      setKbAmount(prev => prev + s);
    }
  };

  const kbClearField = () => {
    if (kbActiveField === 'number') setKbNumber('');
    else { setKbAmount(''); setKbAmountSelected(false); }
  };

  // Moves focus into Amount — if it already holds a value from a previous
  // entry, that value is marked "selected" so the next digit replaces it
  // instead of appending, the same way tabbing into a pre-filled text
  // input with select-all-on-focus would behave.
  const focusAmount = () => {
    setKbActiveField('amount');
    setKbAmountSelected(kbAmount !== '');
  };

  // Tab key — jumps focus between the Number and Amount boxes, replacing
  // the recording's "/" (straight multi-number) key, which the keypad no
  // longer exposes.
  const kbToggleField = () => {
    if (kbActiveField === 'number') focusAmount();
    else setKbActiveField('number');
  };

  const kbPressR = () => {
    if (!/^\d{1,2}$/.test(kbNumber.trim())) { toast.error('Type a 2-digit number first'); return; }
    setKbMode('reverse');
    // Number is done (R needs nothing further) — jump straight to Amount,
    // selecting any leftover value from a previous entry so it's ready to
    // be typed over.
    focusAmount();
  };

  const kbSelectTab = (t: typeof KB_TABS[number]) => {
    setKbMode(t.id);
    setKbNumber('');
    // Fixed-list modes (ပါဝါ/နက္ခတ်/အပူး) need no number at all — jump
    // straight to Amount (selecting any leftover value) instead of a
    // Number box that's about to be disabled.
    if (KB_FIXED_LIST_MODES.includes(t.id)) focusAmount();
    else setKbActiveField('number');
  };

  // ENTER — commits the current number+mode+amount into the pending list.
  // Amount is deliberately left as-is (sticky) afterward, matching the
  // recording: after every ENTER, only the number field and mode reset.
  const kbEnter = () => {
    const amt = parseInt(kbAmount || '', 10);
    if (!kbAmount || isNaN(amt) || amt < 0) { toast.error('Enter an amount'); return; }
    const result = computeKbEntries(kbMode, kbNumber, amt);
    if ('error' in result) { toast.error(result.error); return; }
    setKbPending(prev => [...prev, ...result]);
    setKbNumber('');
    setKbMode(null);
    setKbActiveField('number');
  };

  // OK — commits whatever's currently sitting in the boxes (same as ENTER)
  // if any, then checks everything gathered so far against each number's
  // remaining entry limit (same convention as Bulk Entry's pre-submit
  // check) before opening the confirm dialog. Running totals accumulate as
  // we walk the list so two pending rows on the same number are checked
  // against each other too, not just against what's already submitted.
  const kbOpenConfirm = () => {
    let nextPending = kbPending;
    // Fixed-list modes (ပါဝါ/နက္ခတ်/အပူး) need no digit typed in — let a
    // direct OK/Submit commit them even if the number box is empty.
    const isFixedList = kbMode !== null && KB_FIXED_LIST_MODES.includes(kbMode as KbTabId);
    if (kbNumber.trim() || isFixedList) {
      const amt = parseInt(kbAmount || '', 10);
      if (!kbAmount || isNaN(amt) || amt < 0) { toast.error('Enter an amount'); return; }
      const result = computeKbEntries(kbMode, kbNumber, amt);
      if ('error' in result) { toast.error(result.error); return; }
      nextPending = [...kbPending, ...result];
      setKbPending(nextPending);
      setKbNumber('');
      setKbMode(null);
    }
    if (nextPending.length === 0) { toast.error('No entries to submit'); return; }

    const used: Record<string, number> = { ...getTotals(currentUserId) };
    const valid: { number: string; amount: number }[] = [];
    const invalid: { number: string; amount: number; error: string }[] = [];
    for (const e of nextPending) {
      const lim = limitTable.find(r => r.number === e.number)?.limit ?? 0;
      const already = used[e.number] ?? 0;
      const remaining = lim - already;
      if (e.amount > remaining) {
        invalid.push({ ...e, error: `Limit exceeded for #${e.number}. Remaining: ${remaining.toLocaleString()}` });
      } else {
        valid.push(e);
        used[e.number] = already + e.amount;
      }
    }
    setKbConfirmInfo({ valid, invalid });
    setKbShowConfirm(true);
  };

  const kbClearAll = () => {
    setKbPending([]);
    setKbNumber('');
    setKbAmount('');
    setKbMode(null);
    setKbActiveField('number');
    setKbConfirmInfo(null);
  };

  // ပါဝါ/နက္ခတ်/အပူး are fixed-list modes — no number needed, so the Number
  // box is disabled while one of them is selected.
  const kbNumberDisabled = kbMode !== null && KB_FIXED_LIST_MODES.includes(kbMode as KbTabId);

  // Only the limit-valid subset (kbConfirmInfo.valid) is ever sent to the
  // server. Limit-invalid entries, plus anything the server itself still
  // rejects, are rebuilt back into kbPending to edit and resubmit — same
  // "submit valid only, keep invalid to fix" recovery pattern as Bulk Entry.
  const kbSubmit = async () => {
    const info = kbConfirmInfo;
    if (!info || info.valid.length === 0) { setKbShowConfirm(false); setKbConfirmInfo(null); return; }
    const res = await submitBetEntries(info.valid);
    setKbShowConfirm(false);
    if (res.error) { toast.error(res.error); return; }
    if (res.insertedCount > 0) {
      toast.success(`${res.insertedCount} bet${res.insertedCount !== 1 ? 's' : ''} submitted`);
    }
    const serverRejected: { number: string; amount: number }[] = [];
    res.results.forEach((r, i) => { if (r.status === 'error') serverRejected.push(info.valid[i]); });
    if (serverRejected.length > 0) {
      toast.error(`${serverRejected.length} entr${serverRejected.length !== 1 ? 'ies' : 'y'} rejected — left in the list to fix`);
    }
    setKbPending([...info.invalid.map(({ error, ...e }) => e), ...serverRejected]);
    setKbConfirmInfo(null);
  };

  // Invoice
  const winNum = session.winningNumber;
  const grossBet = myEntries.reduce((s, e) => s + e.amount, 0);
  const commission = user ? grossBet * user.commissionRate / 100 : 0;
  const netPayable = grossBet - commission;
  const winHeldAmt = winNum ? myEntries.filter(e => e.number === winNum).reduce((s, e) => s + e.amount, 0) : 0;
  const payoutAmt = winNum && user ? winHeldAmt * user.payoutRate : 0;
  const pnl = netPayable - payoutAmt;
  const payoutDetail = formatPayoutDetail(winNum, winHeldAmt, user?.payoutRate ?? 0);

  const invoiceText = useMemo(() => {
    const fmt = (n: number) => n.toLocaleString();
    const lines: string[] = [];
    lines.push(`Invoice — ${user?.username ?? '—'} — ${session.label} — ${new Date(session.openedAt).toLocaleDateString()}`);
    lines.push(`Winning Number: ${winNum ?? 'Not set'}`);
    lines.push('─'.repeat(40));
    const byNum: Record<string, number> = {};
    myEntries.forEach(e => { byNum[e.number] = (byNum[e.number] || 0) + e.amount; });
    const rows = Object.entries(byNum).map(([number, amount]) => ({ number, amount }));
    lines.push(rows.length > 0 ? formatIndexValueLines(rows, 'index') : '(no entries)');
    lines.push('─'.repeat(40));
    lines.push(`Gross Bet Total: ${fmt(grossBet)}`);
    lines.push(`Commission (${user?.commissionRate ?? 0}%): ${fmt(Math.round(commission))}`);
    lines.push(`Net Payable: ${fmt(Math.round(netPayable))}`);
    lines.push(`Payout${payoutDetail ? ` (${payoutDetail})` : ''}: ${winNum ? fmt(payoutAmt) : '—'}`);
    lines.push(`Net P&L: ${winNum ? `${pnl >= 0 ? '+' : ''}${fmt(Math.round(pnl))}` : '—'}`);
    return lines.join('\n');
  }, [myEntries, session, winNum, user, grossBet, commission, netPayable, payoutAmt, payoutDetail, pnl]);

  const copyInvoice = async () => {
    try {
      await navigator.clipboard.writeText(invoiceText);
      setCopied(true);
      toast.success('Invoice copied');
      setTimeout(() => setCopied(false), 2000);
    } catch { toast.error('Copy failed'); }
  };

  // 16px minimum on every form control — anything smaller makes iOS Safari
  // auto-zoom the whole page when the field is focused, which feels broken
  // on a phone. This is otherwise identical to the old 13px style.
  const inp = { padding: '8px 12px', borderRadius: 8, outline: 'none', background: C.card2, border: `1px solid ${C.border}`, color: C.text, fontSize: 16 };
  const fmt = (n: number) => n.toLocaleString();

  // Extra top padding on notched/Dynamic-Island phones once installed as a
  // standalone PWA (index.html's viewport-fit=cover lets content draw under
  // the notch) — env() resolves to 0 in a normal browser tab, so this is a
  // no-op there and only matters for the installed app.
  const HEADER_H = 52;
  const headerSafeTop = 'env(safe-area-inset-top, 0px)';

  return (
    <div className="min-h-screen w-full" style={{ background: C.bg, color: C.text }}>
      {/* Header */}
      <header className="flex items-center gap-3 px-4 sticky top-0 z-20"
        style={{
          background: C.card, borderBottom: `1px solid ${C.border}`,
          paddingTop: `calc(12px + ${headerSafeTop})`, paddingBottom: 12,
        }}>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: C.goldGrad }}>
            <span style={{ fontSize: 12 }}>♦</span>
          </div>
          <span style={{ color: C.gold, fontSize: 13, fontWeight: 800, letterSpacing: '0.08em' }}>TREASURE</span>
        </div>
        <div className="flex-1 flex items-center justify-center gap-2 flex-wrap min-w-0">
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: isOpen ? C.green : C.red }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: isOpen ? C.greenText : C.redText }}>
            SESSION {session.status.toUpperCase()}
          </span>
          {remainingMs !== null && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: C.orangeBg }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.orangeText, fontVariantNumeric: 'tabular-nums' }}>
                closes in {formatCountdown(remainingMs)}
              </span>
            </span>
          )}
          {held && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: C.blueBg }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.blueText, fontVariantNumeric: 'tabular-nums' }}>
                on hold — {formatCountdown(holdRemainingMs ?? 0)}
              </span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* min-w-0 + truncate: a long username must never force the header
              into horizontal overflow on a narrow phone — it ellipsizes
              instead. The stats line is hidden below the `sm` breakpoint
              (i.e. on real phones) to keep the header from feeling cramped;
              it's still visible on the Invoice tab below. */}
          <div className="text-right min-w-0" style={{ maxWidth: 160 }}>
            <p style={{ color: C.text, fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.username}
            </p>
            <p className="hidden sm:block" style={{ color: C.textDim, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.commissionRate}% comm · {user?.payoutRate}× pay
            </p>
          </div>
          <button onClick={() => logout()}
            style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', padding: 4, flexShrink: 0 }}>
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* Warning banners */}
      {activeWarnings.map(w => (
        <div key={w.id} className="flex items-start gap-3 px-4 py-3"
          style={{ background: C.orangeBg, borderBottom: `1px solid ${C.orange}33` }}>
          <Bell size={14} color={C.orange} className="flex-shrink-0 mt-0.5" />
          <p style={{ color: C.orangeText, fontSize: 13, flex: 1 }}>{w.message}</p>
          <button onClick={() => setDismissedWarnings(d => [...d, w.id])}
            style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', padding: 2 }}>
            <X size={14} />
          </button>
        </div>
      ))}

      {/* Tabs — sticks directly below the header; offset accounts for the
          same safe-area inset added to the header above so the two stay
          flush against each other on notched phones too. */}
      <div className="flex gap-1 p-3 sticky z-10" style={{ background: C.bg, top: `calc(${HEADER_H}px + ${headerSafeTop})`, borderBottom: `1px solid ${C.border}` }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl"
            style={{
              background: tab === id ? C.goldDim : 'transparent',
              color: tab === id ? C.gold : C.textMuted,
              border: `1px solid ${tab === id ? C.border : 'transparent'}`,
              fontSize: 12, fontWeight: tab === id ? 600 : 400, cursor: 'pointer',
            }}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {/* Content — bottom safe-area padding keeps the last card clear of the
          home-indicator gesture bar when installed as a standalone PWA. */}
      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4" style={{
        paddingBottom: mode === 'keyboard' && tab === 'entry' && kbDockHeight > 0
          ? kbDockHeight + 16
          : 'max(20px, env(safe-area-inset-bottom, 0px))',
      }}>
        {/* DATA ENTRY TAB */}
        {tab === 'entry' && (
          <>
            {!isOpen && (
              <div className="rounded-xl p-5 flex items-center gap-3" style={{ background: C.redBg, border: `1px solid ${C.red}33` }}>
                <AlertCircle size={18} color={C.red} />
                <div>
                  <p style={{ color: C.redText, fontSize: 14, fontWeight: 700 }}>Session Closed</p>
                  <p style={{ color: C.textMuted, fontSize: 12 }}>Data entry is disabled until the admin opens a new session.</p>
                </div>
              </div>
            )}
            {isOpen && !entryOpen && (
              <div className="rounded-xl p-5 flex items-center gap-3" style={{ background: C.redBg, border: `1px solid ${C.red}33` }}>
                <AlertCircle size={18} color={C.red} />
                <div>
                  <p style={{ color: C.redText, fontSize: 14, fontWeight: 700 }}>Your Entry Is Closed</p>
                  <p style={{ color: C.textMuted, fontSize: 12 }}>The admin has closed your data entry for this session. Contact your admin to reopen it.</p>
                </div>
              </div>
            )}
            {isOpen && entryOpen && held && (
              <div className="rounded-xl p-5 flex items-center gap-3" style={{ background: C.blueBg, border: `1px solid ${C.blue}33` }}>
                <AlertCircle size={18} color={C.blue} />
                <div>
                  <p style={{ color: C.blueText, fontSize: 14, fontWeight: 700 }}>Entry Temporarily Held</p>
                  <p style={{ color: C.textMuted, fontSize: 12 }}>The admin has paused entries for everyone — resumes automatically in {formatCountdown(holdRemainingMs ?? 0)}.</p>
                </div>
              </div>
            )}
            {canEnter && (
              <>
                {/* Mode toggle */}
                <div className="flex gap-1 p-1 rounded-xl w-fit flex-wrap" style={{ background: C.card }}>
                  {(['bulk', 'keyboard'] as EntryMode[]).map(m => (
                    <button key={m} onClick={() => setMode(m)}
                      className="px-5 py-2 rounded-lg capitalize"
                      style={{
                        background: mode === m ? C.goldDim : 'transparent',
                        color: mode === m ? C.gold : C.textMuted,
                        border: `1px solid ${mode === m ? C.border : 'transparent'}`,
                        fontSize: 12, fontWeight: mode === m ? 600 : 400, cursor: 'pointer',
                      }}>
                      {m === 'bulk' ? 'Bulk Entry' : 'Keyboard Entry'}
                    </button>
                  ))}
                </div>

                {mode === 'bulk' ? (
                  <div className="rounded-xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                    <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                      <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em' }}>BULK ENTRY</p>
                      <div className="flex gap-2">
                        <button onClick={pasteBulk}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                          style={{ background: C.card2, color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                          <ClipboardPaste size={12} /> Paste
                        </button>
                        <button onClick={clearBulk}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                          style={{ background: C.card2, color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                          <Trash2 size={12} /> Clear
                        </button>
                      </div>
                    </div>
                    <div className="p-3 rounded-lg mb-3" style={{ background: C.card2, border: `1px solid ${C.borderSubtle}` }}>
                      <p style={{ color: C.textDim, fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 4 }}>SUPPORTED FORMATS</p>
                      <p style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.6, fontFamily: 'monospace' }}>
                        46 = 500 &nbsp;·&nbsp; 46 500 &nbsp;·&nbsp; 46R1000 (+ reverse) &nbsp;·&nbsp; 58-300 &nbsp;·&nbsp; 87 - 2000 &nbsp;·&nbsp; 47=300
                      </p>
                    </div>
                    <textarea
                      rows={7}
                      value={bulkText}
                      onChange={e => { setBulkText(e.target.value); setParsed(null); }}
                      placeholder={BULK_PLACEHOLDER}
                      style={{ ...inp, width: '100%', resize: 'vertical', fontFamily: 'monospace', lineHeight: 1.6 }}
                    />
                    <div className="flex gap-3 mt-3">
                      <button onClick={parseBulk}
                        className="flex-1 py-2.5 rounded-xl"
                        style={{ background: C.blueBg, color: C.blueText, border: `1px solid ${C.blue}44`, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                        Parse & Validate
                      </button>
                      {parsed && (
                        <button
                          onClick={() => {
                            if (!bulkStats || bulkStats.validLines.length === 0) { toast.error('No valid lines to submit'); return; }
                            setShowBulkConfirm(true);
                          }}
                          className="flex-1 py-2.5 rounded-xl"
                          style={{
                            background: C.goldGrad, color: '#000', border: 'none',
                            cursor: 'pointer', fontSize: 13, fontWeight: 700,
                            opacity: bulkStats && bulkStats.validLines.length === 0 ? 0.5 : 1,
                          }}>
                          Submit Valid Lines ({bulkStats?.validLines.length ?? 0})
                        </button>
                      )}
                    </div>

                    {/* Parse results */}
                    {parsed && bulkStats && (
                      <div className="mt-4 space-y-2">
                        <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em' }}>PARSE RESULTS</p>

                        {/* Valid-total summary — the count/amount a submit will actually send */}
                        <div className="flex items-center justify-between gap-2 p-3 rounded-xl flex-wrap"
                          style={{ background: C.greenBg, border: `1px solid ${C.green}33` }}>
                          <span style={{ color: C.greenText, fontSize: 12, fontWeight: 700 }}>
                            {bulkStats.validLines.length} valid entr{bulkStats.validLines.length === 1 ? 'y' : 'ies'} · Total: {bulkStats.total.toLocaleString()}
                          </span>
                          {bulkStats.invalidLines.length > 0 && (
                            <span style={{ color: C.redText, fontSize: 12, fontWeight: 600 }}>
                              {bulkStats.invalidLines.length} invalid line{bulkStats.invalidLines.length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>

                        {/* Invalid lines only — valid ones are already covered by the
                            summary bar above (count + total), no need to list each
                            one individually. Each invalid line shows its raw text
                            plus the reason (bad format or over the entry limit). */}
                        {bulkStats.invalidLines.length > 0 && (
                          <div className="p-3 rounded-xl" style={{ background: C.redBg, border: `1px solid ${C.red}33` }}>
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <span style={{ color: C.redText, fontSize: 11, fontWeight: 700 }}>Invalid lines</span>
                              <button onClick={clearInvalidBulk}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
                                style={{ background: C.card, color: C.redText, border: `1px solid ${C.red}44`, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                                <Scissors size={11} /> Clear Invalid
                              </button>
                            </div>
                            <div className="space-y-2">
                              {bulkStats.invalidLines.map((p, i) => (
                                <div key={i} className="flex items-start gap-2">
                                  <AlertCircle size={12} color={C.red} className="flex-shrink-0 mt-0.5" />
                                  <div className="flex-1 min-w-0">
                                    <code style={{ display: 'block', color: C.redText, fontSize: 11, fontFamily: 'monospace' }}>
                                      {p.raw || '(blank)'}
                                    </code>
                                    {p.error && <p style={{ color: C.redText, fontSize: 10, opacity: 0.85, marginTop: 1 }}>{p.error}</p>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Confirm-before-submit — bulk entries are money, so make sure
                        the user knows exactly what's about to go in, and that any
                        invalid lines are being left behind on purpose. */}
                    {showBulkConfirm && bulkStats && (
                      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
                        <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                          <h2 style={{ color: C.text, fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
                            Submit Valid Lines?
                          </h2>
                          <p style={{ color: C.textMuted, fontSize: 13, marginBottom: 6 }}>
                            This will submit <strong>{bulkStats.validLines.length}</strong> valid line{bulkStats.validLines.length !== 1 ? 's' : ''} totaling{' '}
                            <strong>{bulkStats.total.toLocaleString()}</strong>.
                          </p>
                          {bulkStats.invalidLines.length > 0 && (
                            <p style={{ color: C.redText, fontSize: 12, marginBottom: 6 }}>
                              {bulkStats.invalidLines.length} invalid line{bulkStats.invalidLines.length !== 1 ? 's' : ''} will NOT be submitted and will stay in the box for you to fix.
                            </p>
                          )}
                          <p style={{ color: C.textDim, fontSize: 11, marginBottom: 20 }}>
                            Only the valid lines above will be sent. Continue?
                          </p>
                          <div className="flex gap-3">
                            <button onClick={() => setShowBulkConfirm(false)} className="flex-1 py-2.5 rounded-lg"
                              style={{ background: C.card2, color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 13 }}>
                              Cancel
                            </button>
                            <button onClick={submitBulk} className="flex-1 py-2.5 rounded-lg"
                              style={{ background: C.goldGrad, color: '#000', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                              Confirm Submit
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="rounded-xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                      <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 10 }}>KEYBOARD ENTRY</p>

                      {/* Pending entries — nothing reaches the server until OK -> Confirm.
                          Everything else (total, Number/Mode/Amount, pattern tabs, keypad,
                          Cancel/Submit) now lives in the fixed dock below, always visible,
                          so this is the only part of Keyboard Entry that scrolls. */}
                      <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${C.borderSubtle}` }}>
                        <div className="grid grid-cols-3" style={{ background: C.card2 }}>
                          <span style={{ padding: '7px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: C.textDim }}>NO</span>
                          <span style={{ padding: '7px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: C.textDim }}>NUMBER</span>
                          <span style={{ padding: '7px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: C.textDim, textAlign: 'right' }}>AMOUNT</span>
                        </div>
                        {kbPending.length === 0 ? (
                          <p style={{ color: C.textDim, fontSize: 12, padding: '18px 10px', textAlign: 'center' }}>
                            No entries yet — type a number, pick a mode if needed, set an amount, then ENTER.
                          </p>
                        ) : (
                          <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
                            {kbPending.map((p, i) => (
                              <div key={i} className="grid grid-cols-3 items-center" style={{ borderTop: `1px solid ${C.borderSubtle}` }}>
                                <span style={{ padding: '7px 10px', fontSize: 12, color: C.textDim }}>{i + 1}</span>
                                <span style={{ padding: '7px 10px', fontSize: 13, fontWeight: 700, color: C.gold }}>{p.number}</span>
                                <div className="flex items-center justify-end gap-2" style={{ padding: '7px 10px' }}>
                                  <span style={{ fontSize: 13, color: C.text }}>{p.amount.toLocaleString()}</span>
                                  <button onClick={() => setKbPending(prev => prev.filter((_, j) => j !== i))}
                                    style={{ background: 'none', border: 'none', color: C.redText, cursor: 'pointer', padding: 2 }}>
                                    <X size={12} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Fixed bottom dock — Total/entries, Number/Mode/Amount, the 8
                        Burmese pattern tabs, the keypad, and Cancel/Submit are all
                        pinned to the bottom of the viewport (not just the keypad, as
                        before), full-bleed width with the same max-w-2xl content
                        column centered inside it. kbDockRef + a ResizeObserver measure
                        its real rendered height so the scrollable content above gets
                        exactly enough bottom padding to never sit underneath it. No
                        card padding wraps it, so there's no dead margin under Submit/
                        Cancel — it sits flush against the bottom of the screen (with
                        just the safe-area inset on notched phones). */}
                    <div ref={kbDockRef} style={{
                      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40,
                      background: C.card, borderTop: `1px solid ${C.border}`,
                      boxShadow: '0 -6px 20px rgba(0,0,0,0.35)',
                    }}>
                      <div className="max-w-2xl mx-auto px-4" style={{
                        paddingTop: 10, paddingBottom: `max(10px, env(safe-area-inset-bottom, 0px))`,
                      }}>
                        {/* Total */}
                        <div className="flex items-center justify-between px-1 mb-2">
                          <span style={{ color: C.textMuted, fontSize: 12, fontWeight: 600 }}>
                            Total = {kbPending.reduce((s, p) => s + p.amount, 0).toLocaleString()}
                          </span>
                          <span style={{ color: C.textDim, fontSize: 11 }}>{kbPending.length} entr{kbPending.length !== 1 ? 'ies' : 'y'}</span>
                        </div>

                        {/* Number / Mode / Amount — tap Number or Amount to type into it.
                            Number is disabled for fixed-list modes (ပါဝါ/နက္ခတ်/အပူး),
                            which need only an amount. */}
                        <div className="grid grid-cols-3 gap-2 mb-2">
                          <button onClick={() => !kbNumberDisabled && setKbActiveField('number')}
                            disabled={kbNumberDisabled}
                            style={{
                              ...inp, minWidth: 0, textAlign: 'center', fontWeight: 700,
                              cursor: kbNumberDisabled ? 'not-allowed' : 'pointer',
                              background: kbNumberDisabled ? C.card3 : kbActiveField === 'number' ? C.card2 : C.card3,
                              border: `1px solid ${kbNumberDisabled ? C.borderSubtle : kbActiveField === 'number' ? C.gold : C.border}`,
                              opacity: kbNumberDisabled ? 0.45 : 1,
                            }}>
                            {kbNumberDisabled
                              ? <span style={{ color: C.textDim, fontWeight: 400 }}>N/A</span>
                              : kbNumber || <span style={{ color: C.textDim, fontWeight: 400 }}>Number</span>}
                          </button>
                          <div style={{ ...inp, minWidth: 0, textAlign: 'center', color: C.textDim, fontWeight: 600, background: C.card3 }}>
                            {kbMode === 'reverse' ? 'R' : KB_TABS.find(t => t.id === kbMode)?.label ?? 'ဒဲ့'}
                          </div>
                          <button onClick={focusAmount}
                            style={{
                              ...inp, minWidth: 0, textAlign: 'center', fontWeight: 700, cursor: 'pointer',
                              background: kbActiveField === 'amount' ? C.card2 : C.card3,
                              border: `1px solid ${kbActiveField === 'amount' ? C.gold : C.border}`,
                            }}>
                            {kbAmount
                              ? (
                                // Highlighted like selected text when landed on with a
                                // leftover value — the next digit replaces it outright.
                                <span style={kbActiveField === 'amount' && kbAmountSelected
                                  ? { background: C.gold, color: '#000', borderRadius: 3, padding: '1px 4px' }
                                  : undefined}>
                                  {kbAmount}
                                </span>
                              )
                              : <span style={{ color: C.textDim, fontWeight: 400 }}>Amount</span>}
                          </button>
                        </div>

                        {/* Pattern tabs — all 8 are live, exact Burmese labels + rules
                            confirmed directly by the user. */}
                        <div className="grid grid-cols-4 gap-1.5 mb-2">
                          {KB_TABS.map(t => (
                            <button key={t.id} onClick={() => kbSelectTab(t)}
                              style={{
                                padding: '8px 2px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                background: kbMode === t.id ? C.goldDim : C.card2,
                                color: kbMode === t.id ? C.gold : C.textMuted,
                                border: `1px solid ${kbMode === t.id ? C.borderBright : C.borderSubtle}`,
                              }}>
                              {t.label}
                            </button>
                          ))}
                        </div>

                        {/* Keypad — digits + function keys (R, Tab, ENTER, Clear). Nekkhat/
                            Kwe/Apar moved into the tab row above now that all 8 patterns
                            are live, so this is a plain 4x4 grid. ENTER spans both bottom
                            rows (a taller primary key, matches a real calculator's Enter). */}
                        <div className="grid grid-cols-4 gap-1.5">
                          {(['7', '8', '9'] as const).map(d => (
                            <button key={d} onClick={() => kbAppend(d)} style={{ padding: '10px 0', borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: 'pointer', background: C.card2, color: C.text, border: `1px solid ${C.border}` }}>{d}</button>
                          ))}
                          <button onClick={kbPressR} style={{ padding: '10px 0', borderRadius: 8, fontSize: 14, fontWeight: 800, cursor: 'pointer', background: C.blueBg, color: C.blueText, border: `1px solid ${C.blue}44` }}>R</button>

                          {(['4', '5', '6'] as const).map(d => (
                            <button key={d} onClick={() => kbAppend(d)} style={{ padding: '10px 0', borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: 'pointer', background: C.card2, color: C.text, border: `1px solid ${C.border}` }}>{d}</button>
                          ))}
                          <button onClick={kbToggleField} style={{ padding: '10px 0', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', background: C.blueBg, color: C.blueText, border: `1px solid ${C.blue}44` }}>Tab</button>

                          {(['1', '2', '3'] as const).map(d => (
                            <button key={d} onClick={() => kbAppend(d)} style={{ padding: '10px 0', borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: 'pointer', background: C.card2, color: C.text, border: `1px solid ${C.border}` }}>{d}</button>
                          ))}
                          <button onClick={kbEnter} style={{ gridRow: 'span 2', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer', background: C.greenBg, color: C.greenText, border: `1px solid ${C.green}44` }}>ENTER</button>

                          <button onClick={kbClearField} style={{ padding: '10px 0', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', background: C.redBg, color: C.redText, border: `1px solid ${C.red}44` }}>Clear</button>
                          <button onClick={() => kbAppend('0')} style={{ padding: '10px 0', borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: 'pointer', background: C.card2, color: C.text, border: `1px solid ${C.border}` }}>0</button>
                          <button onClick={() => kbAppend('00')} style={{ padding: '10px 0', borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: 'pointer', background: C.card2, color: C.text, border: `1px solid ${C.border}` }}>00</button>
                        </div>

                        {/* Bottom action bar — Cancel wipes the whole pending list, Submit
                            (same as OK in the recording) opens the confirm dialog. */}
                        <div className="flex gap-3 mt-1.5">
                          <button onClick={kbClearAll}
                            className="flex-1 py-2.5 rounded-xl"
                            style={{ background: C.redBg, color: C.redText, border: `1px solid ${C.red}44`, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                            Cancel
                          </button>
                          <button onClick={kbOpenConfirm}
                            className="flex-1 py-2.5 rounded-xl"
                            style={{ background: C.goldGrad, color: '#000', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 800 }}>
                            Submit
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Confirm modal — shows the valid/invalid breakdown computed
                        in kbOpenConfirm (checked against each number's remaining
                        entry limit) before anything is sent to the server. */}
                    {kbShowConfirm && kbConfirmInfo && (
                      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
                        <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: C.card, border: `1px solid ${C.border}`, maxHeight: '85vh', overflowY: 'auto' }}>
                          <h2 style={{ color: C.text, fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
                            Confirm Entries
                          </h2>
                          <p style={{ color: C.textMuted, fontSize: 13, marginBottom: 12 }}>
                            This will submit <strong>{kbConfirmInfo.valid.length}</strong> valid entr{kbConfirmInfo.valid.length !== 1 ? 'ies' : 'y'} totaling{' '}
                            <strong>{kbConfirmInfo.valid.reduce((s, e) => s + e.amount, 0).toLocaleString()}</strong>. This can't be undone.
                          </p>
                          {kbConfirmInfo.invalid.length > 0 && (
                            <div className="mb-3 p-3 rounded-lg" style={{ background: C.redBg, border: `1px solid ${C.red}33` }}>
                              <p style={{ color: C.redText, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                                {kbConfirmInfo.invalid.length} invalid entr{kbConfirmInfo.invalid.length !== 1 ? 'ies' : 'y'} will NOT be submitted and will stay in the list for you to fix.
                              </p>
                              <div className="space-y-1">
                                {kbConfirmInfo.invalid.map((e, i) => (
                                  <p key={i} style={{ color: C.redText, fontSize: 11 }}>
                                    #{e.number} = {e.amount.toLocaleString()} — {e.error}
                                  </p>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="flex gap-3">
                            <button onClick={() => { setKbShowConfirm(false); setKbConfirmInfo(null); }} className="flex-1 py-2.5 rounded-lg"
                              style={{ background: C.card2, color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 13 }}>
                              Cancel
                            </button>
                            <button onClick={kbSubmit} disabled={kbConfirmInfo.valid.length === 0} className="flex-1 py-2.5 rounded-lg"
                              style={{
                                background: kbConfirmInfo.valid.length === 0 ? C.card2 : C.goldGrad,
                                color: kbConfirmInfo.valid.length === 0 ? C.textDim : '#000',
                                border: 'none', cursor: kbConfirmInfo.valid.length === 0 ? 'not-allowed' : 'pointer',
                                fontSize: 13, fontWeight: 700, opacity: kbConfirmInfo.valid.length === 0 ? 0.6 : 1,
                              }}>
                              Confirm Submit
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* HISTORY TAB */}
        {tab === 'history' && (
          <div className="space-y-4">
            {/* Session picker */}
            <div className="rounded-xl p-4 flex items-center gap-3 flex-wrap" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <CalendarClock size={14} color={C.textDim} />
              <span style={{ color: C.textMuted, fontSize: 12, fontWeight: 600 }}>Session:</span>
              <select
                value={selectedSessionId}
                onChange={e => setSelectedSessionId(e.target.value)}
                style={{ ...inp, flex: 1, minWidth: 180 }}>
                <option value="">{session.label} (current)</option>
                {allSessions.filter(s => s.id !== session.id).map(s => (
                  <option key={s.id} value={s.id}>{s.label} — {s.status}{s.winningNumber ? ` — #${s.winningNumber}` : ''}</option>
                ))}
              </select>
            </div>

            <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <div className="px-5 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
                <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em' }}>
                  ENTRY HISTORY — {viewedSession?.label ?? session.label} ({viewedEntries.length} entries)
                </p>
              </div>
              {loadingHistory ? (
                <p style={{ color: C.textDim, fontSize: 13, padding: '32px 20px', textAlign: 'center' }}>Loading…</p>
              ) : viewedEntries.length === 0 ? (
                <p style={{ color: C.textDim, fontSize: 13, padding: '32px 20px', textAlign: 'center' }}>No entries for this session</p>
              ) : (
                <div style={{ maxHeight: 560, overflowY: 'auto' }}>
                  {historyBatches.map((batch, bi) => (
                    <div key={batch.timestamp} style={{ borderTop: bi === 0 ? 'none' : `6px solid ${C.bg}` }}>
                      <div className="px-4 py-2 flex items-center justify-between" style={{ background: C.card2, position: 'sticky', top: 0 }}>
                        <span style={{ color: C.textDim, fontSize: 11, letterSpacing: '0.04em' }}>
                          {new Date(batch.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          {' · '}{batch.entries.length} {batch.entries.length === 1 ? 'entry' : 'entries'}
                        </span>
                        <span style={{ color: C.gold, fontSize: 13, fontWeight: 700 }}>
                          Total {batch.total.toLocaleString()}
                        </span>
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <tbody>
                          {batch.entries.map(e => (
                            <tr key={e.id} style={{ borderTop: `1px solid ${C.borderSubtle}` }}>
                              <td style={{ padding: '8px 16px' }}>
                                <span style={{ color: C.gold, fontSize: 13, fontWeight: 700 }}>{e.number}</span>
                              </td>
                              <td style={{ padding: '8px 16px', textAlign: 'right' }}>
                                <span style={{ color: C.text, fontSize: 13 }}>{e.amount.toLocaleString()}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* P&L snapshot for the selected past session */}
            {viewingPastSession && historicalPnl && (
              <div className="rounded-xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 12 }}>
                  P&L — {viewedSession?.label}
                </p>
                {(() => {
                  // historicalEntries is already scoped to this user (fetched
                  // filtered by currentUserId), so summing it by the past
                  // session's winning number gives the same held-on-win basis
                  // calculate_pnl used server-side.
                  const pastWinNum = viewedSession?.winningNumber ?? null;
                  const pastHeldAmt = pastWinNum
                    ? (historicalEntries ?? []).filter(e => e.number === pastWinNum).reduce((s, e) => s + e.amount, 0)
                    : 0;
                  const pastPayoutDetail = formatPayoutDetail(pastWinNum, pastHeldAmt, user?.payoutRate ?? 0);
                  return [
                    { label: 'Gross Bet Total', val: fmt(historicalPnl.grossIntake), color: C.text },
                    { label: 'Commission', val: `-${fmt(Math.round(historicalPnl.commissionTotal))}`, color: C.orangeText },
                    { label: 'Net Payable', val: fmt(Math.round(historicalPnl.netIntake)), color: C.blueText },
                    { label: `Payout${pastPayoutDetail ? ` (${pastPayoutDetail})` : ''}`, val: historicalPnl.winningNumberSet ? fmt(historicalPnl.payout ?? 0) : '—', color: C.greenText },
                    { label: 'Net P&L', val: historicalPnl.winningNumberSet ? `${(historicalPnl.netPnl ?? 0) >= 0 ? '+' : ''}${fmt(Math.round(historicalPnl.netPnl ?? 0))}` : '—', color: (historicalPnl.netPnl ?? 0) >= 0 ? C.greenText : C.redText },
                  ];
                })().map((row, i) => (
                  <div key={i} className="flex justify-between py-1.5" style={{ borderBottom: i < 4 ? `1px solid ${C.borderSubtle}` : 'none' }}>
                    <span style={{ color: C.textMuted, fontSize: 13 }}>{row.label}</span>
                    <span style={{ color: row.color, fontSize: 13, fontWeight: i === 4 ? 800 : 600 }}>{row.val}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* INVOICE TAB */}
        {tab === 'invoice' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p style={{ color: C.text, fontSize: 15, fontWeight: 700 }}>Invoice</p>
                <p style={{ color: C.textMuted, fontSize: 12 }}>{session.label}</p>
              </div>
              <button onClick={copyInvoice}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl"
                style={{
                  background: copied ? C.greenBg : C.goldGrad,
                  color: copied ? C.greenText : '#000',
                  border: copied ? `1px solid ${C.green}44` : 'none',
                  cursor: 'pointer', fontSize: 13, fontWeight: 700,
                }}>
                {copied ? <CheckCheck size={14} /> : <Copy size={14} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, background: C.card2 }}>
                    <tr>
                      <th style={{ padding: '10px 16px', textAlign: 'left', color: C.textDim, fontSize: 11, letterSpacing: '0.06em' }}>NUMBER</th>
                      <th style={{ padding: '10px 16px', textAlign: 'right', color: C.textDim, fontSize: 11, letterSpacing: '0.06em' }}>AMOUNT BET</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const byNum: Record<string, number> = {};
                      myEntries.forEach(e => { byNum[e.number] = (byNum[e.number] || 0) + e.amount; });
                      return Object.entries(byNum).sort(([a], [b]) => a.localeCompare(b)).map(([num, amt]) => (
                        <tr key={num} style={{ borderTop: `1px solid ${C.borderSubtle}` }}>
                          <td style={{ padding: '10px 16px' }}>
                            <span style={{ color: C.gold, fontSize: 13, fontWeight: 700 }}>{num}</span>
                          </td>
                          <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                            <span style={{ color: C.text, fontSize: 13 }}>{fmt(amt)}</span>
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-4 space-y-2" style={{ borderTop: `1px solid ${C.border}`, background: C.card2 }}>
                {[
                  { label: 'Gross Bet Total', val: fmt(grossBet), color: C.text },
                  { label: `Commission (${user?.commissionRate ?? 0}%)`, val: `-${fmt(Math.round(commission))}`, color: C.orangeText },
                  { label: 'Net Payable', val: fmt(Math.round(netPayable)), color: C.blueText },
                  { label: `Payout${payoutDetail ? ` (${payoutDetail})` : ''}`, val: winNum ? fmt(payoutAmt) : '—', color: C.greenText },
                  { label: 'Net P&L', val: winNum ? `${pnl >= 0 ? '+' : ''}${fmt(Math.round(pnl))}` : '—', color: pnl >= 0 ? C.greenText : C.redText },
                ].map((row, i) => (
                  <div key={i} className="flex justify-between">
                    <span style={{ color: C.textMuted, fontSize: 13 }}>{row.label}</span>
                    <span style={{ color: row.color, fontSize: 13, fontWeight: i === 4 ? 800 : 600 }}>{row.val}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 8 }}>PLAIN TEXT (index = value)</p>
              <pre style={{ color: C.textMuted, fontSize: 10, lineHeight: 1.6, overflowX: 'auto', whiteSpace: 'pre', fontFamily: 'monospace' }}>
                {invoiceText}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
