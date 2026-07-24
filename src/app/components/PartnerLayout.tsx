import { useState, useMemo, useEffect } from 'react';
import { LogOut, Bell, X, ArrowUpDown, Copy, CheckCheck, Send, History as HistoryIcon, CalendarClock } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '../context';
import { C } from '../theme';
import type { PartnerShare, AdminPnl } from '../types';
import { formatIndexValueLines, sortIndexValueRows, copyToClipboard, formatPayoutDetail, type IndexValueSort } from '../utils/format';
import { useCountdownMs, formatCountdown } from '../utils/countdown';

type Tab = 'data' | 'report';
type SortMode = IndexValueSort;

export function PartnerLayout() {
  const {
    logout, currentUserId, session, partnerShares, partners, warnings, partnerOverLimitHistory, sendPartnerOverLimit, setMySubLimit,
    allSessions, fetchSessionPartnerShares, fetchSessionPnl,
  } = useApp();
  const [tab, setTab] = useState<Tab>('data');
  const [withinSort, setWithinSort] = useState<SortMode>('value');
  const [overSort, setOverSort] = useState<SortMode>('value');
  const [dismissedWarnings, setDismissedWarnings] = useState<string[]>([]);
  const [copiedWithin, setCopiedWithin] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [showOverLimitHistory, setShowOverLimitHistory] = useState(false);
  const [copiedHistoryId, setCopiedHistoryId] = useState<string | null>(null);
  const [applyingSubLimit, setApplyingSubLimit] = useState(false);

  const partner = partners.find(p => p.id === currentUserId);

  // Persisted on the partner's own account row (set_my_sub_limit RPC) — this
  // used to be local component state that silently reset to a hardcoded
  // default on every reload, same bug class as Admin's Total Data Limit
  // Threshold. Derive from context instead of holding a separate copy.
  const subLimit = partner?.subLimitValue ?? 3000;
  const [subLimitInput, setSubLimitInput] = useState(String(subLimit));

  useEffect(() => {
    setSubLimitInput(String(subLimit));
  }, [partner?.id, subLimit]);

  const applySubLimit = async () => {
    const v = parseInt(subLimitInput);
    if (isNaN(v) || v < 0) { toast.error('Enter a valid sub-limit value'); return; }
    setApplyingSubLimit(true);
    const { error } = await setMySubLimit(v);
    setApplyingSubLimit(false);
    if (error) { toast.error(error); return; }
    toast.success('Sub-limit applied');
  };

  const isOpen = session.status === 'open';
  const remainingMs = useCountdownMs(isOpen ? session.autoCloseAt : null);
  const holdRemainingMs = useCountdownMs(isOpen ? session.entryHoldUntil : null);
  const held = holdRemainingMs !== null && holdRemainingMs > 0;

  const activeWarnings = warnings.filter(w =>
    !dismissedWarnings.includes(w.id) &&
    (w.targetRole === 'all' || w.targetRole === 'partners')
  );

  const myShares = partnerShares.filter(ps => ps.partnerId === currentUserId);

  // Admin may share to this partner more than once per session (e.g. a
  // second "Share to Partners" run after more bets come in) — each run adds
  // its own row to partner_shares, so the same number can appear multiple
  // times. Sum them by number here rather than showing duplicate rows: two
  // shares of 88 (500, then 1000) must read as a single 88 = 1500.
  const allReceivedRows = useMemo(() => {
    const totals: Record<string, number> = {};
    myShares.forEach(ps => { totals[ps.number] = (totals[ps.number] || 0) + ps.sharedAmount; });
    return Object.entries(totals).map(([number, amount]) => ({ number, amount }));
  }, [myShares]);

  // --- Session history (Report tab session picker) ---
  // '' means "current session" — defaults to the live data above (no extra
  // fetch); only pulls a past session's own partner_shares + P&L on demand
  // when actually selected, so it never disturbs the live Data View tab.
  const [selectedReportSessionId, setSelectedReportSessionId] = useState('');
  const [historicalShares, setHistoricalShares] = useState<PartnerShare[] | null>(null);
  const [historicalPnl, setHistoricalPnl] = useState<AdminPnl | null>(null);
  const [loadingReportHistory, setLoadingReportHistory] = useState(false);

  const viewingPastSession = selectedReportSessionId !== '' && selectedReportSessionId !== session.id;
  const viewedSession = viewingPastSession ? allSessions.find(s => s.id === selectedReportSessionId) : session;

  useEffect(() => {
    if (!viewingPastSession) { setHistoricalShares(null); setHistoricalPnl(null); return; }
    let cancelled = false;
    setLoadingReportHistory(true);
    Promise.all([
      fetchSessionPartnerShares(selectedReportSessionId),
      fetchSessionPnl(selectedReportSessionId),
    ]).then(([shares, { pnl }]) => {
      if (cancelled) return;
      setHistoricalShares(shares.filter(ps => ps.partnerId === currentUserId));
      setHistoricalPnl(pnl ?? null);
      setLoadingReportHistory(false);
    });
    return () => { cancelled = true; };
  }, [viewingPastSession, selectedReportSessionId, currentUserId, fetchSessionPartnerShares, fetchSessionPnl]);

  const viewedAllReceivedRows = useMemo(() => {
    if (!viewingPastSession) return allReceivedRows;
    const totals: Record<string, number> = {};
    (historicalShares ?? []).forEach(ps => { totals[ps.number] = (totals[ps.number] || 0) + ps.sharedAmount; });
    return Object.entries(totals).map(([number, amount]) => ({ number, amount }));
  }, [viewingPastSession, historicalShares, allReceivedRows]);

  // Left panel: EVERY number received, shown capped at my sub-limit — a
  // number over the sub-limit still shows here at the capped value (e.g.
  // received 45=50000, sub-limit=30000 → left panel shows 45=30000), it
  // isn't excluded outright. Only the excess moves to the right panel.
  const withinLimitRows = useMemo(() => {
    const rows = allReceivedRows.map(r => ({ number: r.number, amount: Math.min(r.amount, subLimit) }));
    return sortIndexValueRows(rows, withinSort);
  }, [allReceivedRows, subLimit, withinSort]);

  // My own "Send" history for this session — once I press Send, the
  // over-sub-limit amount for a number is archived here (see
  // send_partner_over_limit RPC) and must net out of the live panel below,
  // exactly like Admin's Share History nets out of Total Data Management.
  const myOverLimitHistory = useMemo(
    () => partnerOverLimitHistory.filter(e => e.partnerId === currentUserId),
    [partnerOverLimitHistory, currentUserId]
  );

  const alreadySentByNumber = useMemo(() => {
    const m: Record<string, number> = {};
    myOverLimitHistory.forEach(entry => {
      entry.records.forEach(r => { m[r.number] = (m[r.number] || 0) + r.overLimitAmount; });
    });
    return m;
  }, [myOverLimitHistory]);

  // Right panel: numbers over my sub-limit — just the REMAINING excess
  // portion not yet sent. Once fully sent, a number's remaining amount
  // drops to 0 and disappears from here; the full record stays visible
  // (and copyable) under History instead.
  const overLimitRows = useMemo(() => {
    const rows = allReceivedRows
      .map(r => ({ number: r.number, overLimit: Math.max(0, r.amount - subLimit - (alreadySentByNumber[r.number] || 0)) }))
      .filter(r => r.overLimit > 0);
    return sortIndexValueRows(rows.map(r => ({ number: r.number, amount: r.overLimit })), overSort)
      .map(r => ({ number: r.number, overLimit: r.amount }));
  }, [allReceivedRows, subLimit, overSort, alreadySentByNumber]);

  const totalReceived = allReceivedRows.reduce((s, r) => s + r.amount, 0);
  const withinTotal = withinLimitRows.reduce((s, r) => s + r.amount, 0);
  const totalOverLimit = overLimitRows.reduce((s, r) => s + r.overLimit, 0);

  const winNum = session.winningNumber;
  const gross = totalReceived;
  const commission = partner ? gross * partner.commissionRate / 100 : 0;
  const net = gross - commission;
  const heldOnWin = winNum
    ? myShares.filter(ps => ps.number === winNum).reduce((s, ps) => s + ps.sharedAmount, 0)
    : 0;
  const payout = winNum && partner ? heldOnWin * partner.payoutRate : 0;
  const pnl = net - payout;
  const payoutDetail = formatPayoutDetail(winNum, heldOnWin, partner?.payoutRate ?? 0);

  // Report tab figures for whichever session is selected — server-
  // authoritative calculate_pnl result for a past session, live-computed
  // values above for the current one.
  const reportWinNum = viewingPastSession ? (viewedSession?.winningNumber ?? null) : winNum;
  const reportGross = viewingPastSession ? (historicalPnl?.grossIntake ?? 0) : gross;
  const reportCommission = viewingPastSession ? (historicalPnl?.commissionTotal ?? 0) : commission;
  const reportNet = viewingPastSession ? (historicalPnl?.netIntake ?? 0) : net;
  const reportPayout = viewingPastSession ? (historicalPnl?.payout ?? 0) : payout;
  const reportPnl = viewingPastSession ? (historicalPnl?.netPnl ?? 0) : pnl;
  // viewedAllReceivedRows already covers both live and historical shares by
  // number (see its definition above), so the same lookup works for either.
  const reportHeldOnWin = reportWinNum ? (viewedAllReceivedRows.find(r => r.number === reportWinNum)?.amount ?? 0) : 0;
  const reportPayoutDetail = formatPayoutDetail(reportWinNum, reportHeldOnWin, partner?.payoutRate ?? 0);

  const fmt = (n: number) => n.toLocaleString();

  const copyWithinLimit = async () => {
    const text = formatIndexValueLines(withinLimitRows, withinSort);
    const ok = await copyToClipboard(text);
    if (!ok) { toast.error('Copy failed'); return; }
    setCopiedWithin(true);
    toast.success('Within-limit table copied');
    setTimeout(() => setCopiedWithin(false), 2000);
  };

  const copyOverLimit = async () => {
    const text = formatIndexValueLines(overLimitRows.map(r => ({ number: r.number, amount: r.overLimit })), overSort);
    const ok = await copyToClipboard(text);
    if (!ok) { toast.error('Copy failed'); return; }
    setCopied(true);
    toast.success('Over-limit table copied');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSend = async () => {
    setSending(true);
    const res = await sendPartnerOverLimit(subLimit);
    setSending(false);
    if (res.error) { toast.error(res.error); return; }
    if (!res.totalSentAmount) { toast.error(res.message || 'No over-limit amount to send right now'); return; }
    toast.success(`Sent ${res.totalSentAmount.toLocaleString()} over-limit — recorded in History`);
  };

  const copyOverLimitHistoryEntry = async (entryId: string) => {
    const entry = myOverLimitHistory.find(h => h.id === entryId);
    if (!entry) return;
    const text = formatIndexValueLines(
      entry.records.map(r => ({ number: r.number, amount: r.overLimitAmount })),
      'index'
    );
    const ok = await copyToClipboard(text);
    if (!ok) { toast.error('Copy failed'); return; }
    setCopiedHistoryId(entryId);
    toast.success('History entry copied');
    setTimeout(() => setCopiedHistoryId(null), 2000);
  };

  const reportText = useMemo(() => {
    const fmtN = (n: number) => `${n}`;
    const receivedLines = formatIndexValueLines(viewedAllReceivedRows, 'index');
    const overRows = viewedAllReceivedRows.filter(r => r.amount > subLimit).map(r => ({ number: r.number, amount: r.amount - subLimit }));
    const overLines = overRows.length > 0 ? formatIndexValueLines(overRows, 'index') : '(none)';
    const lines: string[] = [];
    const label = viewedSession?.label ?? session.label;
    const openedAt = viewedSession?.openedAt ?? session.openedAt;
    lines.push(`Partner Report — ${partner?.username ?? '—'} — ${label} — ${new Date(openedAt).toLocaleDateString()}`);
    lines.push(`Winning Number: ${reportWinNum ?? 'Not set'}`);
    lines.push('─'.repeat(40));
    lines.push('RECEIVED (index = value)');
    lines.push(receivedLines || '(none)');
    lines.push('─'.repeat(40));
    lines.push(`OVER MY SUB-LIMIT (${fmtN(subLimit)}) (index = value)`);
    lines.push(overLines);
    lines.push('─'.repeat(40));
    lines.push(`Gross Received: ${fmt(reportGross)}`);
    lines.push(`Commission (${partner?.commissionRate ?? 0}%): ${fmt(Math.round(reportCommission))}`);
    lines.push(`Net Intake: ${fmt(Math.round(reportNet))}`);
    lines.push(`Payout${reportPayoutDetail ? ` (${reportPayoutDetail})` : ''}: ${reportWinNum ? fmt(reportPayout) : '—'}`);
    lines.push(`Net P&L: ${reportWinNum ? `${reportPnl >= 0 ? '+' : ''}${fmt(Math.round(reportPnl))}` : '—'}`);
    return lines.join('\n');
  }, [viewedAllReceivedRows, session, viewedSession, reportWinNum, partner, reportGross, reportCommission, reportNet, reportPayout, reportPayoutDetail, reportPnl, subLimit]);

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      setReportCopied(true);
      toast.success('Report copied');
      setTimeout(() => setReportCopied(false), 2000);
    } catch { toast.error('Copy failed'); }
  };

  // 16px minimum on every form control — anything smaller makes iOS Safari
  // auto-zoom the whole page when the field is focused, which feels broken
  // on a phone. This is otherwise identical to the old 13px style.
  const inp = { padding: '8px 12px', borderRadius: 8, outline: 'none', background: C.card2, border: `1px solid ${C.border}`, color: C.text, fontSize: 16 };

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
              it's still visible on the Report tab below. */}
          <div className="text-right min-w-0" style={{ maxWidth: 160 }}>
            <p style={{ color: C.text, fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {partner?.username}
            </p>
            <p className="hidden sm:block" style={{ color: C.textDim, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Partner · {partner?.commissionRate}% comm · {partner?.sharePercentage}% share
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
        {[{ id: 'data' as Tab, label: 'Data View' }, { id: 'report' as Tab, label: 'Report' }].map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id)}
            className="flex-1 py-2 rounded-xl"
            style={{
              background: tab === id ? C.goldDim : 'transparent',
              color: tab === id ? C.gold : C.textMuted,
              border: `1px solid ${tab === id ? C.border : 'transparent'}`,
              fontSize: 12, fontWeight: tab === id ? 600 : 400, cursor: 'pointer',
            }}>{label}</button>
        ))}
      </div>

      {/* Content — bottom safe-area padding keeps the last card clear of the
          home-indicator gesture bar when installed as a standalone PWA. */}
      <div className="max-w-4xl mx-auto px-4 py-5" style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom, 0px))' }}>
        {/* DATA VIEW */}
        {tab === 'data' && (
          <div className="space-y-4">
            {/* Sub-limit control */}
            <div className="rounded-xl p-4 flex items-center gap-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <div>
                <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 2 }}>MY SUB-LIMIT</p>
                <p style={{ color: C.textMuted, fontSize: 11 }}>Numbers received above this threshold appear in Over Limit</p>
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <input type="number" value={subLimitInput}
                  onChange={e => setSubLimitInput(e.target.value)}
                  style={{ ...inp, width: 100 }} />
                <button onClick={applySubLimit} disabled={applyingSubLimit}
                  style={{
                    background: C.goldGrad, color: '#000', border: 'none',
                    cursor: applyingSubLimit ? 'not-allowed' : 'pointer', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                  }}>
                  {applyingSubLimit ? 'Applying…' : 'Apply'}
                </button>
              </div>
            </div>

            {myShares.length === 0 ? (
              <div className="rounded-xl p-10 flex flex-col items-center" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: C.card2 }}>
                  <span style={{ fontSize: 24, opacity: 0.3 }}>♦</span>
                </div>
                <p style={{ color: C.textMuted, fontSize: 14 }}>No data received yet</p>
                <p style={{ color: C.textDim, fontSize: 12, marginTop: 4 }}>Admin hasn't distributed over-limit data for this session</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Left: Within sub-limit */}
                <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                  <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
                    <div>
                      <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em' }}>WITHIN LIMIT</p>
                      <p style={{ color: C.textDim, fontSize: 10, marginTop: 1 }}>capped at {subLimit.toLocaleString()}</p>
                    </div>
                    <button onClick={() => setWithinSort(s => s === 'index' ? 'value' : 'index')}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg"
                      style={{ background: C.card2, color: C.textMuted, border: 'none', cursor: 'pointer', fontSize: 11 }}>
                      <ArrowUpDown size={11} /> {withinSort === 'index' ? 'Index ↑' : 'Value ↓'}
                    </button>
                  </div>
                  <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead style={{ position: 'sticky', top: 0, background: C.card2 }}>
                        <tr>
                          <th style={{ padding: '8px 14px', textAlign: 'left', color: C.textDim, fontSize: 11, letterSpacing: '0.06em' }}>NUM</th>
                          <th style={{ padding: '8px 14px', textAlign: 'right', color: C.textDim, fontSize: 11, letterSpacing: '0.06em' }}>RECEIVED</th>
                        </tr>
                      </thead>
                      <tbody>
                        {withinLimitRows.length === 0 ? (
                          <tr><td colSpan={2} style={{ padding: '24px 14px', textAlign: 'center', color: C.textDim, fontSize: 12 }}>No numbers within sub-limit</td></tr>
                        ) : withinLimitRows.map(r => (
                          <tr key={r.number} style={{ borderTop: `1px solid ${C.borderSubtle}` }}>
                            <td style={{ padding: '8px 14px' }}>
                              <span style={{ color: C.gold, fontSize: 15, fontWeight: 700 }}>{r.number}</span>
                            </td>
                            <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                              <span style={{ color: C.greenText, fontSize: 13 }}>{fmt(r.amount)}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-4 py-3 space-y-3" style={{ borderTop: `1px solid ${C.border}` }}>
                    <div className="flex items-center justify-between">
                      <span style={{ color: C.textMuted, fontSize: 12 }}>Within Total</span>
                      <span style={{ color: C.textDim, fontSize: 11 }}>Count: {withinLimitRows.length}</span>
                      <span style={{ color: C.greenText, fontSize: 13, fontWeight: 700 }}>{fmt(withinTotal)}</span>
                    </div>
                    {withinLimitRows.length > 0 && (
                      <button onClick={copyWithinLimit}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded-xl"
                        style={{
                          background: copiedWithin ? C.greenBg : C.card2,
                          color: copiedWithin ? C.greenText : C.textMuted,
                          border: `1px solid ${copiedWithin ? C.green + '44' : C.borderSubtle}`,
                          cursor: 'pointer', fontSize: 12, fontWeight: 600,
                        }}>
                        {copiedWithin ? <CheckCheck size={13} /> : <Copy size={13} />}
                        {copiedWithin ? 'Copied!' : 'Copy (index = value)'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Right: Over Limit */}
                <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                  <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
                    <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em' }}>OVER MY LIMIT</p>
                    <button onClick={() => setOverSort(s => s === 'index' ? 'value' : 'index')}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg"
                      style={{ background: C.card2, color: C.textMuted, border: 'none', cursor: 'pointer', fontSize: 11 }}>
                      <ArrowUpDown size={11} /> {overSort === 'index' ? 'Index ↑' : 'Value ↓'}
                    </button>
                  </div>

                  {overLimitRows.length === 0 ? (
                    <div className="flex flex-col items-center py-10">
                      <p style={{ color: C.greenText, fontSize: 13 }}>
                        {myOverLimitHistory.length > 0 ? 'All over-limit data sent — nothing outstanding' : 'All received data within sub-limit'}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead style={{ position: 'sticky', top: 0, background: C.card2 }}>
                            <tr>
                              <th style={{ padding: '8px 14px', textAlign: 'left', color: C.textDim, fontSize: 11, letterSpacing: '0.06em' }}>NUM</th>
                              <th style={{ padding: '8px 14px', textAlign: 'right', color: C.textDim, fontSize: 11, letterSpacing: '0.06em' }}>OVER AMT</th>
                            </tr>
                          </thead>
                          <tbody>
                            {overLimitRows.map(r => (
                              <tr key={r.number} style={{ borderTop: `1px solid ${C.borderSubtle}` }}>
                                <td style={{ padding: '8px 14px' }}>
                                  <span style={{ color: C.gold, fontSize: 15, fontWeight: 700 }}>{r.number}</span>
                                </td>
                                <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                                  <span style={{ color: C.orangeText, fontSize: 13, fontWeight: 700 }}>{fmt(r.overLimit)}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="px-4 py-3 space-y-3" style={{ borderTop: `1px solid ${C.border}` }}>
                        <div className="flex items-center justify-between">
                          <span style={{ color: C.textMuted, fontSize: 12 }}>Total Over Limit</span>
                          <span style={{ color: C.textDim, fontSize: 11 }}>Count: {overLimitRows.length}</span>
                          <span style={{ color: C.orangeText, fontSize: 13, fontWeight: 700 }}>{fmt(totalOverLimit)}</span>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={copyOverLimit}
                            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl"
                            style={{
                              background: copied ? C.greenBg : C.card2,
                              color: copied ? C.greenText : C.textMuted,
                              border: `1px solid ${copied ? C.green + '44' : C.borderSubtle}`,
                              cursor: 'pointer', fontSize: 13, fontWeight: 600,
                            }}>
                            {copied ? <CheckCheck size={14} /> : <Copy size={14} />}
                            {copied ? 'Copied!' : 'Copy'}
                          </button>
                          <button onClick={handleSend} disabled={sending}
                            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl"
                            style={{
                              background: C.goldGrad, color: '#000', border: 'none',
                              cursor: sending ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700,
                            }}>
                            <Send size={14} /> {sending ? 'Sending…' : 'Send'}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Sent-over-limit History */}
            <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <button onClick={() => setShowOverLimitHistory(s => !s)}
                className="w-full flex items-center justify-between px-4 py-3"
                style={{ background: 'none', border: 'none', cursor: 'pointer', borderBottom: showOverLimitHistory ? `1px solid ${C.border}` : 'none' }}>
                <div className="flex items-center gap-2">
                  <HistoryIcon size={13} color={C.textDim} />
                  <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em' }}>
                    SENT HISTORY ({myOverLimitHistory.length})
                  </p>
                </div>
                <span style={{ color: C.textDim, fontSize: 11 }}>{showOverLimitHistory ? 'Hide' : 'Show'}</span>
              </button>
              {showOverLimitHistory && (
                myOverLimitHistory.length === 0 ? (
                  <p style={{ color: C.textDim, fontSize: 13, padding: '24px 16px', textAlign: 'center' }}>
                    No Send actions yet this session
                  </p>
                ) : (
                  <div className="divide-y" style={{ borderColor: C.borderSubtle }}>
                    {myOverLimitHistory.map(entry => (
                      <div key={entry.id} className="px-4 py-3 space-y-2" style={{ borderTop: `1px solid ${C.borderSubtle}` }}>
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div>
                            <span style={{ color: C.textDim, fontSize: 11 }}>
                              sub-limit {entry.subLimitUsed.toLocaleString()} · {entry.records.length} number{entry.records.length !== 1 ? 's' : ''} · {new Date(entry.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span style={{ color: C.orangeText, fontSize: 13, fontWeight: 700 }}>{entry.totalSentAmount.toLocaleString()}</span>
                            <button onClick={() => copyOverLimitHistoryEntry(entry.id)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg"
                              style={{
                                background: copiedHistoryId === entry.id ? C.greenBg : C.card2,
                                color: copiedHistoryId === entry.id ? C.greenText : C.textMuted,
                                border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                              }}>
                              {copiedHistoryId === entry.id ? <CheckCheck size={12} /> : <Copy size={12} />}
                              {copiedHistoryId === entry.id ? 'Copied!' : 'Copy'}
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {entry.records.map(r => (
                            <span key={r.number} style={{ background: C.card2, color: C.textSub, fontSize: 13, padding: '2px 8px', borderRadius: 6 }}>
                              {r.number} = {r.overLimitAmount.toLocaleString()}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>

            {/* P&L snapshot (if winning number set) */}
            {winNum && (
              <div className="rounded-xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 12 }}>
                  P&L SNAPSHOT — WIN #{winNum}
                </p>
                {[
                  { label: 'Gross Received', val: fmt(gross), color: C.text },
                  { label: `Commission (${partner?.commissionRate ?? 0}%)`, val: `-${fmt(Math.round(commission))}`, color: C.orangeText },
                  { label: 'Net Intake', val: fmt(Math.round(net)), color: C.blueText },
                  { label: `Payout${payoutDetail ? ` (${payoutDetail})` : ''}`, val: `-${fmt(payout)}`, color: C.redText },
                  { label: 'Net P&L', val: `${pnl >= 0 ? '+' : ''}${fmt(Math.round(pnl))}`, color: pnl >= 0 ? C.greenText : C.redText },
                ].map((row, i) => (
                  <div key={i} className="flex justify-between py-2" style={{ borderBottom: i < 4 ? `1px solid ${C.borderSubtle}` : 'none' }}>
                    <span style={{ color: C.textMuted, fontSize: 13 }}>{row.label}</span>
                    <span style={{ color: row.color, fontSize: 13, fontWeight: i === 4 ? 800 : 600 }}>{row.val}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* REPORT TAB */}
        {tab === 'report' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p style={{ color: C.text, fontSize: 15, fontWeight: 700 }}>Partner Report</p>
                <p style={{ color: C.textMuted, fontSize: 12 }}>{viewedSession?.label ?? session.label} · {partner?.username}</p>
              </div>
              <button onClick={copyReport}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl"
                style={{
                  background: reportCopied ? C.greenBg : C.goldGrad,
                  color: reportCopied ? C.greenText : '#000',
                  border: reportCopied ? `1px solid ${C.green}44` : 'none',
                  cursor: 'pointer', fontSize: 13, fontWeight: 700,
                }}>
                {reportCopied ? <CheckCheck size={14} /> : <Copy size={14} />}
                {reportCopied ? 'Copied!' : 'Copy Report'}
              </button>
            </div>

            {/* Session picker */}
            <div className="rounded-xl p-4 flex items-center gap-3 flex-wrap" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <CalendarClock size={14} color={C.textDim} />
              <span style={{ color: C.textMuted, fontSize: 12, fontWeight: 600 }}>Session:</span>
              <select
                value={selectedReportSessionId}
                onChange={e => setSelectedReportSessionId(e.target.value)}
                style={{ ...inp, flex: 1, minWidth: 180 }}>
                <option value="">{session.label} (current)</option>
                {allSessions.filter(s => s.id !== session.id).map(s => (
                  <option key={s.id} value={s.id}>{s.label} — {s.status}{s.winningNumber ? ` — #${s.winningNumber}` : ''}</option>
                ))}
              </select>
            </div>

            <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, background: C.card2 }}>
                    <tr>
                      {['NUM', 'RECEIVED', 'OVER LIMIT'].map(h => (
                        <th key={h} style={{ padding: '10px 14px', color: C.textDim, fontSize: 11, letterSpacing: '0.06em', textAlign: h === 'NUM' ? 'left' : 'right' as any }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loadingReportHistory ? (
                      <tr><td colSpan={3} style={{ padding: '32px 14px', textAlign: 'center', color: C.textDim, fontSize: 13 }}>Loading…</td></tr>
                    ) : viewedAllReceivedRows.length === 0 ? (
                      <tr><td colSpan={3} style={{ padding: '32px 14px', textAlign: 'center', color: C.textDim, fontSize: 13 }}>No data received for this session</td></tr>
                    ) : [...viewedAllReceivedRows].sort((a, b) => a.number.localeCompare(b.number)).map(r => {
                      const over = r.amount > subLimit ? r.amount - subLimit : 0;
                      return (
                        <tr key={r.number} style={{ borderTop: `1px solid ${C.borderSubtle}` }}>
                          <td style={{ padding: '9px 14px' }}><span style={{ color: C.gold, fontSize: 15, fontWeight: 700 }}>{r.number}</span></td>
                          <td style={{ padding: '9px 14px', textAlign: 'right' }}><span style={{ color: C.text, fontSize: 13 }}>{fmt(r.amount)}</span></td>
                          <td style={{ padding: '9px 14px', textAlign: 'right' }}>
                            <span style={{ color: over > 0 ? C.orangeText : C.textDim, fontSize: 13 }}>{over > 0 ? fmt(over) : '—'}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-4 space-y-2" style={{ borderTop: `1px solid ${C.border}`, background: C.card2 }}>
                {[
                  { label: 'Gross Received', val: fmt(reportGross), color: C.text },
                  { label: `Commission (${partner?.commissionRate ?? 0}%)`, val: `-${fmt(Math.round(reportCommission))}`, color: C.orangeText },
                  { label: 'Net Intake', val: fmt(Math.round(reportNet)), color: C.blueText },
                  { label: `Payout${reportPayoutDetail ? ` (${reportPayoutDetail})` : ''}`, val: reportWinNum ? fmt(reportPayout) : '—', color: C.redText },
                  { label: 'Net P&L', val: reportWinNum ? `${reportPnl >= 0 ? '+' : ''}${fmt(Math.round(reportPnl))}` : '—', color: reportPnl >= 0 ? C.greenText : C.redText },
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
                {reportText}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
