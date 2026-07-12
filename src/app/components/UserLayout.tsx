import { useState, useMemo, useEffect } from 'react';
import { LogOut, Bell, X, AlertCircle, CheckCircle, Copy, CheckCheck, ClipboardList, History, Receipt, CalendarClock } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '../context';
import { C } from '../theme';
import type { BetEntry, AdminPnl } from '../types';
import { formatIndexValueLines } from '../utils/format';
import { useCountdownMs, formatCountdown } from '../utils/countdown';

type Tab = 'entry' | 'history' | 'invoice';
type EntryMode = 'bulk' | 'single';

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

  const submitBulk = async () => {
    if (!parsed) return;
    const validLines = parsed.filter(p => !p.error);
    if (!validLines.length) { toast.error('No valid lines to submit'); return; }

    const flat: { number: string; amount: number }[] = [];
    const lineForFlatIndex: number[] = [];
    validLines.forEach((p, li) => {
      p.entries.forEach(e => { flat.push({ number: e.number, amount: e.amount }); lineForFlatIndex.push(li); });
    });

    const res = await submitBetEntries(flat);
    if (res.error) { toast.error(res.error); return; }

    if (res.insertedCount > 0) {
      toast.success(`${res.insertedCount} bet${res.insertedCount !== 1 ? 's' : ''} submitted`);
    }

    const failedLineIndices = new Set<number>();
    res.results.forEach((r, i) => {
      if (r.status === 'error') failedLineIndices.add(lineForFlatIndex[i]);
    });

    if (failedLineIndices.size > 0) {
      const remaining: ParsedLine[] = [];
      validLines.forEach((p, li) => {
        if (failedLineIndices.has(li)) {
          const errs = res.results
            .filter((r, i) => lineForFlatIndex[i] === li && r.status === 'error')
            .map(r => r.message)
            .filter(Boolean);
          remaining.push({ ...p, error: errs.join('; ') || 'Rejected by server' });
        }
      });
      const clientInvalid = parsed.filter(p => p.error);
      setParsed([...remaining, ...clientInvalid]);
      toast.error(`${failedLineIndices.size} line${failedLineIndices.size !== 1 ? 's' : ''} rejected — see details below`);
    } else {
      setBulkText('');
      setParsed(null);
    }
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
  const payoutAmt = winNum && user
    ? myEntries.filter(e => e.number === winNum).reduce((s, e) => s + e.amount, 0) * user.payoutRate
    : 0;
  const pnl = netPayable - payoutAmt;

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
    lines.push(`Payout (Win #${winNum ?? '—'}): ${winNum ? fmt(payoutAmt) : '—'}`);
    lines.push(`Net P&L: ${winNum ? `${pnl >= 0 ? '+' : ''}${fmt(Math.round(pnl))}` : '—'}`);
    return lines.join('\n');
  }, [myEntries, session, winNum, user, grossBet, commission, netPayable, payoutAmt, pnl]);

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
                <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: C.card }}>
                  {(['bulk', 'single'] as EntryMode[]).map(m => (
                    <button key={m} onClick={() => setMode(m)}
                      className="px-5 py-2 rounded-lg capitalize"
                      style={{
                        background: mode === m ? C.goldDim : 'transparent',
                        color: mode === m ? C.gold : C.textMuted,
                        border: `1px solid ${mode === m ? C.border : 'transparent'}`,
                        fontSize: 12, fontWeight: mode === m ? 600 : 400, cursor: 'pointer',
                      }}>
                      {m === 'bulk' ? 'Bulk Entry' : 'Single Entry'}
                    </button>
                  ))}
                </div>

                {mode === 'bulk' ? (
                  <div className="rounded-xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                    <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 10 }}>BULK ENTRY</p>
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
                        <button onClick={submitBulk}
                          className="flex-1 py-2.5 rounded-xl"
                          style={{ background: C.goldGrad, color: '#000', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                          Submit Valid Lines ({parsed.filter(p => !p.error).length})
                        </button>
                      )}
                    </div>

                    {/* Parse results */}
                    {parsed && (
                      <div className="mt-4 space-y-2">
                        <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em' }}>PARSE RESULTS</p>
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
                {[
                  { label: 'Gross Bet Total', val: fmt(historicalPnl.grossIntake), color: C.text },
                  { label: 'Commission', val: `-${fmt(Math.round(historicalPnl.commissionTotal))}`, color: C.orangeText },
                  { label: 'Net Payable', val: fmt(Math.round(historicalPnl.netIntake)), color: C.blueText },
                  { label: 'Payout', val: historicalPnl.winningNumberSet ? fmt(historicalPnl.payout ?? 0) : '—', color: C.greenText },
                  { label: 'Net P&L', val: historicalPnl.winningNumberSet ? `${(historicalPnl.netPnl ?? 0) >= 0 ? '+' : ''}${fmt(Math.round(historicalPnl.netPnl ?? 0))}` : '—', color: (historicalPnl.netPnl ?? 0) >= 0 ? C.greenText : C.redText },
                ].map((row, i) => (
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
                  { label: `Payout (Win #${winNum ?? '—'} × ${user?.payoutRate ?? 80}×)`, val: winNum ? fmt(payoutAmt) : '—', color: C.greenText },
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
