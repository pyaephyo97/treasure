import { useState, useMemo, useEffect } from 'react';
import { LogOut, Bell, X, AlertCircle, CheckCircle, Copy, CheckCheck, ClipboardList, History, Receipt, CalendarClock, ClipboardPaste, Trash2, Scissors } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '../context';
import { C } from '../theme';
import type { BetEntry, AdminPnl } from '../types';
import { formatIndexValueLines, formatPayoutDetail } from '../utils/format';
import { useCountdownMs, formatCountdown } from '../utils/countdown';

type Tab = 'entry' | 'history' | 'invoice';
type EntryMode = 'bulk' | 'keyboard' | 'single';

// Keyboard Entry's pattern tabs, in the same order/positions as the
// reference recording. Only Head/Tail/Break are wired to real generation
// logic — their outputs were verified frame-by-frame against the
// recording (e.g. Break "5" -> 05,14,23,32,41,50,69,78,87,96, all pairs
// summing to 5 mod 10). Power/Ko/Twin-Ko/Twin appear in the recording too
// but their exact generation rule couldn't be confirmed from the video
// alone (Power in particular looks like a curated/external "hot numbers"
// list, not something derivable from the recording) — they're shown
// disabled in the same layout slot rather than guessed at, since this is
// a money-handling feature.
type KbTabId = 'power' | 'twin' | 'ko' | 'head' | 'tail' | 'break' | 'nyiko';
type KbMode = KbTabId | 'reverse' | null;
const KB_TABS: { id: KbTabId; label: string; live: boolean }[] = [
  { id: 'power', label: 'Power', live: false },
  { id: 'twin', label: 'Twin', live: false },
  { id: 'ko', label: 'Ko', live: false },
  { id: 'head', label: 'Head', live: true },
  { id: 'tail', label: 'Tail', live: true },
  { id: 'break', label: 'Break', live: true },
  { id: 'nyiko', label: 'Twin-Ko', live: false },
];

/** Generates the entries a Keyboard Entry ENTER/OK press should add, given
 * the active mode, the typed number, and the amount. Mirrors the exact
 * rules verified against the reference recording:
 *  - 'reverse' (R key): a 2-digit number + its digit-reversed counterpart,
 *    both at `amount` (or one entry at double amount for a palindrome like
 *    55) — same convention as the "46R1000" bulk-entry format.
 *  - 'head': single digit D -> the 10 numbers D0..D9.
 *  - 'tail': single digit D -> the 10 numbers 0D..9D.
 *  - 'break': single digit D -> the 10 numbers whose digits sum to D mod 10.
 *  - default (straight): one or more "/"-separated 1-2 digit numbers, all
 *    at the same amount (e.g. "12/34/56" -> three entries).
 */
function computeKbEntries(
  mode: KbMode, rawNumber: string, amount: number
): { number: string; amount: number }[] | { error: string } {
  const trimmed = rawNumber.trim();
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
    if (parseInt(num) > 99 || amount <= 0) return null;
    const rev = num[1] + num[0];
    if (num === rev) return [{ number: num, amount: amount * 2 }];
    return [{ number: num, amount }, { number: rev, amount }];
  }
  const m = t.match(/^(\d{1,2})\s*[=\-]\s*(\d+)$/) || t.match(/^(\d{1,2})\s+(\d+)$/);
  if (m) {
    const num = m[1].padStart(2, '0');
    const amount = parseInt(m[2]);
    if (parseInt(num) > 99 || amount <= 0) return null;
    return [{ number: num, amount }];
  }
  return null;
}

const BULK_PLACEHOLDER = `46 = 500
07R1000
58-300
87 - 2000
47=300
05 500
55R500`;

export function UserLayout() {
  const {
    logout, currentUserId, session, betEntries, limitTable, users, warnings, submitBetEntries,
    allSessions, fetchSessionBetEntries, fetchSessionPnl,
  } = useApp();
  const [tab, setTab] = useState<Tab>('entry');
  const [mode, setMode] = useState<EntryMode>('bulk');
  const [bulkText, setBulkText] = useState('');
  const [parsed, setParsed] = useState<ParsedLine[] | null>(null);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);

  // --- Keyboard Entry ---
  const [kbNumber, setKbNumber] = useState('');
  const [kbAmount, setKbAmount] = useState('');
  const [kbActiveField, setKbActiveField] = useState<'number' | 'amount'>('number');
  const [kbMode, setKbMode] = useState<KbMode>(null);
  const [kbPending, setKbPending] = useState<{ number: string; amount: number }[]>([]);
  const [kbShowConfirm, setKbShowConfirm] = useState(false);

  const [singleNum, setSingleNum] = useState('');
  const [singleAmt, setSingleAmt] = useState('');
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
    if (kbActiveField === 'number') setKbNumber(prev => prev + s);
    else setKbAmount(prev => prev + s);
  };

  const kbClearField = () => {
    if (kbActiveField === 'number') setKbNumber('');
    else setKbAmount('');
  };

  const kbPressR = () => {
    if (!/^\d{1,2}$/.test(kbNumber.trim())) { toast.error('Type a 2-digit number first'); return; }
    setKbMode('reverse');
  };

  const kbSelectTab = (t: typeof KB_TABS[number]) => {
    if (!t.live) { toast('Coming soon — this pattern wasn’t confirmed from the recording yet.'); return; }
    setKbMode(t.id);
    setKbNumber('');
    setKbActiveField('number');
  };

  const kbStubButton = () => toast('Coming soon — this button wasn’t confirmed from the recording yet.');

  // ENTER — commits the current number+mode+amount into the pending list.
  // Amount is deliberately left as-is (sticky) afterward, matching the
  // recording: after every ENTER, only the number field and mode reset.
  const kbEnter = () => {
    const amt = parseInt(kbAmount || '', 10);
    if (!kbAmount || isNaN(amt) || amt <= 0) { toast.error('Enter an amount'); return; }
    const result = computeKbEntries(kbMode, kbNumber, amt);
    if ('error' in result) { toast.error(result.error); return; }
    setKbPending(prev => [...prev, ...result]);
    setKbNumber('');
    setKbMode(null);
    setKbActiveField('number');
  };

  // OK — commits whatever's currently sitting in the boxes (same as ENTER)
  // if any, then opens the confirm dialog for everything gathered so far.
  const kbOpenConfirm = () => {
    let nextPending = kbPending;
    if (kbNumber.trim()) {
      const amt = parseInt(kbAmount || '', 10);
      if (!kbAmount || isNaN(amt) || amt <= 0) { toast.error('Enter an amount'); return; }
      const result = computeKbEntries(kbMode, kbNumber, amt);
      if ('error' in result) { toast.error(result.error); return; }
      nextPending = [...kbPending, ...result];
      setKbPending(nextPending);
      setKbNumber('');
      setKbMode(null);
    }
    if (nextPending.length === 0) { toast.error('No entries to submit'); return; }
    setKbShowConfirm(true);
  };

  const kbClearAll = () => {
    setKbPending([]);
    setKbNumber('');
    setKbAmount('');
    setKbMode(null);
    setKbActiveField('number');
  };

  const kbSubmit = async () => {
    if (kbPending.length === 0) { setKbShowConfirm(false); return; }
    const flat = kbPending.map(p => ({ number: p.number, amount: p.amount }));
    const res = await submitBetEntries(flat);
    setKbShowConfirm(false);
    if (res.error) { toast.error(res.error); return; }
    if (res.insertedCount > 0) {
      toast.success(`${res.insertedCount} bet${res.insertedCount !== 1 ? 's' : ''} submitted`);
    }
    // Anything the server rejected stays in the pending list to fix and
    // resubmit — same recovery behavior as Bulk Entry.
    const failed: { number: string; amount: number }[] = [];
    res.results.forEach((r, i) => { if (r.status === 'error') failed.push(kbPending[i]); });
    if (failed.length > 0) {
      toast.error(`${failed.length} entr${failed.length !== 1 ? 'ies' : 'y'} rejected — left in the list to fix`);
    }
    setKbPending(failed);
  };

  const submitSingle = async () => {
    const num = singleNum.padStart(2, '0');
    const amt = parseInt(singleAmt);
    if (!/^\d{2}$/.test(num) || parseInt(num) > 99) { toast.error('Invalid number'); return; }
    if (isNaN(amt) || amt <= 0) { toast.error('Invalid amount'); return; }

    const res = await submitBetEntries([{ number: num, amount: amt }]);
    if (res.error) { toast.error(res.error); return; }
    const line = res.results[0];
    if (!line || line.status === 'error') { toast.error(line?.message || 'Entry rejected'); return; }

    toast.success(`Bet #${num} = ${amt.toLocaleString()} submitted`);
    setSingleNum('');
    setSingleAmt('');
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
      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4" style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom, 0px))' }}>
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
                  {(['bulk', 'keyboard', 'single'] as EntryMode[]).map(m => (
                    <button key={m} onClick={() => setMode(m)}
                      className="px-5 py-2 rounded-lg capitalize"
                      style={{
                        background: mode === m ? C.goldDim : 'transparent',
                        color: mode === m ? C.gold : C.textMuted,
                        border: `1px solid ${mode === m ? C.border : 'transparent'}`,
                        fontSize: 12, fontWeight: mode === m ? 600 : 400, cursor: 'pointer',
                      }}>
                      {m === 'bulk' ? 'Bulk Entry' : m === 'keyboard' ? 'Keyboard Entry' : 'Single Entry'}
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

                        {/* Quick-fix: strip only the invalid lines, keep valid ones in the box */}
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
                            <div className="space-y-1">
                              {bulkStats.invalidLines.map((p, i) => (
                                <code key={i} style={{ display: 'block', color: C.redText, fontSize: 11, fontFamily: 'monospace' }}>
                                  {p.raw || '(blank)'}
                                </code>
                              ))}
                            </div>
                          </div>
                        )}

                        {parsed.map((p, i) => (
                          <div key={i} className="p-3 rounded-xl"
                            style={{ background: p.error ? C.redBg : C.greenBg, border: `1px solid ${p.error ? C.red : C.green}33` }}>
                            <div className="flex items-start gap-2">
                              {p.error
                                ? <AlertCircle size={13} color={C.red} className="flex-shrink-0 mt-0.5" />
                                : <CheckCircle size={13} color={C.green} className="flex-shrink-0 mt-0.5" />}
                              <div className="flex-1">
                                <code style={{ color: C.textSub, fontSize: 12, fontFamily: 'monospace' }}>{p.raw}</code>
                                {p.error
                                  ? <p style={{ color: C.redText, fontSize: 11, marginTop: 2 }}>{p.error}</p>
                                  : (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {p.entries.map((e, j) => (
                                        <span key={j} style={{ background: C.goldDim, color: C.gold, fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4 }}>
                                          #{e.number} = {e.amount.toLocaleString()}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                              </div>
                            </div>
                          </div>
                        ))}
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
                ) : mode === 'keyboard' ? (
                  <div className="rounded-xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                    <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 10 }}>KEYBOARD ENTRY</p>

                    {/* Pending entries — nothing reaches the server until OK -> Confirm */}
                    <div className="rounded-lg overflow-hidden mb-3" style={{ border: `1px solid ${C.borderSubtle}` }}>
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
                        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
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

                    {/* Total */}
                    <div className="flex items-center justify-between px-1 mb-3">
                      <span style={{ color: C.textMuted, fontSize: 12, fontWeight: 600 }}>
                        Total = {kbPending.reduce((s, p) => s + p.amount, 0).toLocaleString()}
                      </span>
                      <span style={{ color: C.textDim, fontSize: 11 }}>{kbPending.length} entr{kbPending.length !== 1 ? 'ies' : 'y'}</span>
                    </div>

                    {/* Number / Mode / Amount — tap Number or Amount to type into it */}
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      <button onClick={() => setKbActiveField('number')}
                        style={{
                          ...inp, minWidth: 0, textAlign: 'center', fontWeight: 700, cursor: 'pointer',
                          background: kbActiveField === 'number' ? C.card2 : C.card3,
                          border: `1px solid ${kbActiveField === 'number' ? C.gold : C.border}`,
                        }}>
                        {kbNumber || <span style={{ color: C.textDim, fontWeight: 400 }}>Number</span>}
                      </button>
                      <div style={{ ...inp, minWidth: 0, textAlign: 'center', color: C.textDim, fontWeight: 600, background: C.card3 }}>
                        {kbMode === 'reverse' ? 'R' : KB_TABS.find(t => t.id === kbMode)?.label ?? 'Straight'}
                      </div>
                      <button onClick={() => setKbActiveField('amount')}
                        style={{
                          ...inp, minWidth: 0, textAlign: 'center', fontWeight: 700, cursor: 'pointer',
                          background: kbActiveField === 'amount' ? C.card2 : C.card3,
                          border: `1px solid ${kbActiveField === 'amount' ? C.gold : C.border}`,
                        }}>
                        {kbAmount || <span style={{ color: C.textDim, fontWeight: 400 }}>Amount</span>}
                      </button>
                    </div>

                    {/* Pattern tabs — Head/Tail/Break are live; Power/Twin/Ko/Twin-Ko are shown
                        in the same layout position (matching the recording) but disabled, since
                        their exact generation rule couldn't be confirmed from the recording. */}
                    <div className="grid grid-cols-4 gap-1.5 mb-3">
                      {KB_TABS.map(t => (
                        <button key={t.id} onClick={() => kbSelectTab(t)}
                          style={{
                            padding: '8px 2px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                            background: kbMode === t.id ? C.goldDim : C.card2,
                            color: kbMode === t.id ? C.gold : t.live ? C.textMuted : C.textDim,
                            border: `1px solid ${kbMode === t.id ? C.borderBright : C.borderSubtle}`,
                            opacity: t.live ? 1 : 0.55,
                          }}>
                          {t.label}
                        </button>
                      ))}
                    </div>

                    {/* Keypad — same 4x5 layout as the recording: a special/quick button in
                        the left column of each digit row, digits in the middle, a function
                        key on the right. */}
                    <div className="grid grid-cols-5 gap-1.5">
                      <button onClick={kbStubButton} style={{ padding: '13px 0', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: C.card3, color: C.textDim, border: `1px solid ${C.borderSubtle}` }}>Nekkhat</button>
                      {(['7', '8', '9'] as const).map(d => (
                        <button key={d} onClick={() => kbAppend(d)} style={{ padding: '13px 0', borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: 'pointer', background: C.card2, color: C.text, border: `1px solid ${C.border}` }}>{d}</button>
                      ))}
                      <button onClick={kbPressR} style={{ padding: '13px 0', borderRadius: 8, fontSize: 14, fontWeight: 800, cursor: 'pointer', background: C.blueBg, color: C.blueText, border: `1px solid ${C.blue}44` }}>R</button>

                      <button onClick={kbStubButton} style={{ padding: '13px 0', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: C.card3, color: C.textDim, border: `1px solid ${C.borderSubtle}` }}>Kwe</button>
                      {(['4', '5', '6'] as const).map(d => (
                        <button key={d} onClick={() => kbAppend(d)} style={{ padding: '13px 0', borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: 'pointer', background: C.card2, color: C.text, border: `1px solid ${C.border}` }}>{d}</button>
                      ))}
                      <button onClick={() => kbAppend('/')} style={{ padding: '13px 0', borderRadius: 8, fontSize: 16, fontWeight: 800, cursor: 'pointer', background: C.blueBg, color: C.blueText, border: `1px solid ${C.blue}44` }}>/</button>

                      <button onClick={kbStubButton} style={{ padding: '13px 0', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: C.card3, color: C.textDim, border: `1px solid ${C.borderSubtle}` }}>Apar</button>
                      {(['1', '2', '3'] as const).map(d => (
                        <button key={d} onClick={() => kbAppend(d)} style={{ padding: '13px 0', borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: 'pointer', background: C.card2, color: C.text, border: `1px solid ${C.border}` }}>{d}</button>
                      ))}
                      <button onClick={kbEnter} style={{ padding: '13px 0', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', background: C.blueBg, color: C.blueText, border: `1px solid ${C.blue}44` }}>ENTER</button>

                      <button onClick={kbClearField} style={{ padding: '13px 0', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', background: C.redBg, color: C.redText, border: `1px solid ${C.red}44` }}>Clear</button>
                      <button onClick={() => kbAppend('0')} style={{ padding: '13px 0', borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: 'pointer', background: C.card2, color: C.text, border: `1px solid ${C.border}` }}>0</button>
                      <button onClick={() => kbAppend('00')} style={{ padding: '13px 0', borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: 'pointer', background: C.card2, color: C.text, border: `1px solid ${C.border}` }}>00</button>
                      <button onClick={() => kbAppend('000')} style={{ padding: '13px 0', borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: 'pointer', background: C.card2, color: C.text, border: `1px solid ${C.border}` }}>000</button>
                      <button onClick={kbOpenConfirm} style={{ padding: '13px 0', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer', background: C.goldGrad, color: '#000', border: 'none' }}>OK</button>
                    </div>

                    {/* Bottom action bar — Cancel wipes the whole pending list, Submit
                        opens the same confirm dialog as OK. */}
                    <div className="flex gap-3 mt-3">
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

                    {/* Confirm modal */}
                    {kbShowConfirm && (
                      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
                        <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                          <h2 style={{ color: C.text, fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
                            Confirm Entries
                          </h2>
                          <p style={{ color: C.textMuted, fontSize: 13, marginBottom: 20 }}>
                            Submit <strong>{kbPending.length}</strong> entr{kbPending.length !== 1 ? 'ies' : 'y'} totaling{' '}
                            <strong>{kbPending.reduce((s, p) => s + p.amount, 0).toLocaleString()}</strong>? This can't be undone.
                          </p>
                          <div className="flex gap-3">
                            <button onClick={() => setKbShowConfirm(false)} className="flex-1 py-2.5 rounded-lg"
                              style={{ background: C.card2, color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 13 }}>
                              Cancel
                            </button>
                            <button onClick={kbSubmit} className="flex-1 py-2.5 rounded-lg"
                              style={{ background: C.goldGrad, color: '#000', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                              Confirm Submit
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                    <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 14 }}>SINGLE ENTRY</p>
                    <div className="flex gap-3 mb-4">
                      <div style={{ flex: '0 0 100px' }}>
                        <label style={{ display: 'block', color: C.textMuted, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 5 }}>NUMBER (00–99)</label>
                        <input
                          type="text"
                          maxLength={2}
                          value={singleNum}
                          onChange={e => setSingleNum(e.target.value.replace(/\D/g, ''))}
                          placeholder="46"
                          style={{ ...inp, width: '100%', textAlign: 'center', fontSize: 20, fontWeight: 700, letterSpacing: '0.1em' }}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', color: C.textMuted, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 5 }}>AMOUNT</label>
                        <input
                          type="number"
                          value={singleAmt}
                          onChange={e => setSingleAmt(e.target.value)}
                          placeholder="500"
                          style={{ ...inp, width: '100%' }}
                        />
                      </div>
                    </div>
                    {singleNum.length > 0 && (
                      <div className="mb-3 p-2 rounded-lg" style={{ background: C.card2 }}>
                        {(() => {
                          const num = singleNum.padStart(2, '0');
                          const totals = getTotals(currentUserId);
                          const lim = limitTable.find(r => r.number === num)?.limit ?? 0;
                          const used = totals[num] ?? 0;
                          const rem = lim - used;
                          return (
                            <p style={{ color: rem > 0 ? C.textMuted : C.redText, fontSize: 11 }}>
                              #{num} — Used: {fmt(used)} / Limit: {fmt(lim)} · Remaining: <strong>{fmt(rem)}</strong>
                            </p>
                          );
                        })()}
                      </div>
                    )}
                    <button onClick={submitSingle}
                      className="w-full py-3 rounded-xl"
                      style={{ background: C.goldGrad, color: '#000', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
                      Submit Entry
                    </button>
                  </div>
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
                <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ position: 'sticky', top: 0, background: C.card2 }}>
                      <tr>
                        {['NUM', 'AMOUNT', 'TIME'].map(h => (
                          <th key={h} style={{ padding: '10px 16px', textAlign: h === 'AMOUNT' ? 'right' : 'left', color: C.textDim, fontSize: 11, letterSpacing: '0.06em' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...viewedEntries].reverse().map(e => (
                        <tr key={e.id} style={{ borderTop: `1px solid ${C.borderSubtle}` }}>
                          <td style={{ padding: '10px 16px' }}>
                            <span style={{ color: C.gold, fontSize: 13, fontWeight: 700 }}>{e.number}</span>
                          </td>
                          <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                            <span style={{ color: C.text, fontSize: 13 }}>{e.amount.toLocaleString()}</span>
                          </td>
                          <td style={{ padding: '10px 16px' }}>
                            <span style={{ color: C.textDim, fontSize: 12 }}>
                              {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
