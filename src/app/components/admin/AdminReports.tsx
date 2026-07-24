import { useMemo, useEffect } from 'react';
import { Copy, CheckCheck, CalendarClock } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useApp } from '../../context';
import { C } from '../../theme';
import { formatIndexValueLines, formatPayoutDetail } from '../../utils/format';
import type { BetEntry, PartnerShare, AdminPnl } from '../../types';

const fmt = (n: number) => n.toLocaleString();

type PnlRow = { id: string; username: string; gross: number; commission: number; net: number; heldOnWin: number; payoutRate: number; payout: number; pnl: number | null };

const PNL_TABLE_HEADERS = ['NAME', 'GROSS', 'COMMISSION', 'NET', 'PAYOUT', 'P&L'];

/** Per-User / per-Partner P&L table — module-scoped (not defined inside
 * AdminReports) so it isn't recreated as a brand-new component type on
 * every render, which would otherwise force React to unmount/remount the
 * whole table (losing scroll position, flicker) on every keystroke or
 * state change elsewhere on the page. */
function PnlTable({ title, rows, loading, winNum }: { title: string; rows: PnlRow[]; loading: boolean; winNum: string | null }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <div className="px-5 py-3" style={{ borderBottom: `1px solid ${C.border}`, background: C.card2 }}>
        <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em' }}>{title}</p>
      </div>
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, background: C.card2 }}>
            <tr>
              {PNL_TABLE_HEADERS.map(h => (
                <th key={h} style={{ padding: '10px 14px', color: C.textDim, fontSize: 11, letterSpacing: '0.06em', textAlign: h === 'NAME' ? 'left' : 'right' as any }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: '32px 14px', textAlign: 'center', color: C.textDim, fontSize: 13 }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: '32px 14px', textAlign: 'center', color: C.textDim, fontSize: 13 }}>None managed</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} style={{ borderTop: `1px solid ${C.borderSubtle}` }}>
                <td style={{ padding: '9px 14px' }}><span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{r.username}</span></td>
                <td style={{ padding: '9px 14px', textAlign: 'right' }}><span style={{ color: C.text, fontSize: 13 }}>{fmt(r.gross)}</span></td>
                <td style={{ padding: '9px 14px', textAlign: 'right' }}><span style={{ color: C.orangeText, fontSize: 13 }}>{r.gross > 0 ? `-${fmt(Math.round(r.commission))}` : '—'}</span></td>
                <td style={{ padding: '9px 14px', textAlign: 'right' }}><span style={{ color: C.blueText, fontSize: 13 }}>{fmt(Math.round(r.net))}</span></td>
                <td style={{ padding: '9px 14px', textAlign: 'right' }}>
                  <span style={{ color: C.redText, fontSize: 13 }}>{r.pnl !== null ? fmt(r.payout) : '—'}</span>
                  {r.pnl !== null && (
                    <p style={{ color: C.textDim, fontSize: 10, marginTop: 1 }}>
                      {formatPayoutDetail(winNum, r.heldOnWin, r.payoutRate)}
                    </p>
                  )}
                </td>
                <td style={{ padding: '9px 14px', textAlign: 'right' }}>
                  <span style={{ color: r.pnl === null ? C.textDim : r.pnl >= 0 ? C.greenText : C.redText, fontSize: 13, fontWeight: 700 }}>
                    {r.pnl !== null ? `${r.pnl >= 0 ? '+' : ''}${fmt(Math.round(r.pnl))}` : '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminReports() {
  const {
    session, betEntries, partnerShares, adminPnl, myProfile, users, partners,
    allSessions, fetchSessionBetEntries, fetchSessionPartnerShares, fetchSessionPnl,
  } = useApp();
  const [copied, setCopied] = useState(false);

  // --- Session history picker ---
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [historicalEntries, setHistoricalEntries] = useState<BetEntry[] | null>(null);
  const [historicalShares, setHistoricalShares] = useState<PartnerShare[] | null>(null);
  const [historicalPnl, setHistoricalPnl] = useState<AdminPnl | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const viewingPastSession = selectedSessionId !== '' && selectedSessionId !== session.id;
  const viewedSession = viewingPastSession ? allSessions.find(s => s.id === selectedSessionId) : session;

  useEffect(() => {
    if (!viewingPastSession) { setHistoricalEntries(null); setHistoricalShares(null); setHistoricalPnl(null); return; }
    let cancelled = false;
    setLoadingHistory(true);
    Promise.all([
      fetchSessionBetEntries(selectedSessionId),
      fetchSessionPartnerShares(selectedSessionId),
      fetchSessionPnl(selectedSessionId),
    ]).then(([entries, shares, { pnl }]) => {
      if (cancelled) return;
      setHistoricalEntries(entries);
      setHistoricalShares(shares);
      setHistoricalPnl(pnl ?? null);
      setLoadingHistory(false);
    });
    return () => { cancelled = true; };
  }, [viewingPastSession, selectedSessionId, fetchSessionBetEntries, fetchSessionPartnerShares, fetchSessionPnl]);

  const viewedBetEntries = viewingPastSession ? (historicalEntries ?? []) : betEntries;
  const viewedPartnerShares = viewingPastSession ? (historicalShares ?? []) : partnerShares;
  const viewedAdminPnl = viewingPastSession ? historicalPnl : adminPnl;
  const winNum = viewedSession?.winningNumber ?? null;

  const byNumber = useMemo(() => {
    const m: Record<string, number> = {};
    viewedBetEntries.forEach(e => { m[e.number] = (m[e.number] || 0) + e.amount; });
    return m;
  }, [viewedBetEntries]);

  const sharedByNumber = useMemo(() => {
    const m: Record<string, number> = {};
    viewedPartnerShares.forEach(ps => { m[ps.number] = (m[ps.number] || 0) + ps.sharedAmount; });
    return m;
  }, [viewedPartnerShares]);

  // Matches the persisted threshold from the Total Data page, not a
  // hardcoded guess — keeps this report consistent with what was actually
  // configured for the session being viewed (live or historical).
  const limitThreshold = viewedSession?.totalDataSetLimit ?? 5000;

  const rows = useMemo(() =>
    Object.entries(byNumber)
      .map(([num, total]) => ({
        number: num,
        total,
        overLimit: Math.max(0, total - limitThreshold),
        shared: sharedByNumber[num] || 0,
      }))
      .sort((a, b) => a.number.localeCompare(b.number)),
    [byNumber, sharedByNumber, limitThreshold]
  );

  const localGross = viewedBetEntries.reduce((s, e) => s + e.amount, 0);
  // Admin's own commission rate applied to gross intake — matches
  // calculate_pnl (not a sum of each managed user's individual rate).
  const localCommTotal = localGross * (myProfile?.commissionRate ?? 0) / 100;

  // Prefer the server-authoritative calculate_pnl RPC result (already
  // net of amounts shared to partners, matching spec §4.3's definition of
  // Admin's held data); fall back to a local approximation while it loads.
  const gross = viewedAdminPnl?.grossIntake ?? localGross;
  const commTotal = viewedAdminPnl?.commissionTotal ?? localCommTotal;
  const net = viewedAdminPnl?.netIntake ?? (localGross - localCommTotal);
  const payout = viewedAdminPnl?.payout ?? 0;
  const pnl = viewedAdminPnl?.netPnl ?? 0;
  // Same payout basis calculate_pnl uses for the admin/master_admin branch:
  // bets on the winning number minus whatever was already shared away to
  // partners — shown so the Payout line always says its work, not just a
  // bare total.
  const adminHeldOnWin = winNum ? (byNumber[winNum] || 0) - (sharedByNumber[winNum] || 0) : 0;
  const adminPayoutDetail = formatPayoutDetail(winNum, adminHeldOnWin, myProfile?.payoutRate ?? 0);

  // Per-User and per-Partner P&L — same math calculate_pnl uses for a
  // 'user'/'partner' target (gross -> own commission rate -> net; payout =
  // amount on the winning number x own payout rate), computed client-side
  // over the already-fetched betEntries/partnerShares instead of firing one
  // calculate_pnl RPC call per managed account. Every managed User/Partner
  // is listed even with zero activity, so this doubles as a roster view.
  const userPnlRows = useMemo(() => {
    const byUser: Record<string, { gross: number; winGross: number }> = {};
    viewedBetEntries.forEach(e => {
      const agg = byUser[e.userId] ?? (byUser[e.userId] = { gross: 0, winGross: 0 });
      agg.gross += e.amount;
      if (winNum && e.number === winNum) agg.winGross += e.amount;
    });
    return users.map(u => {
      const agg = byUser[u.id] ?? { gross: 0, winGross: 0 };
      const commission = agg.gross * (u.commissionRate ?? 0) / 100;
      const net = agg.gross - commission;
      const payout = winNum ? agg.winGross * (u.payoutRate ?? 0) : 0;
      const rowPnl = winNum ? net - payout : null;
      return { id: u.id, username: u.username, gross: agg.gross, commission, net, heldOnWin: agg.winGross, payoutRate: u.payoutRate ?? 0, payout, pnl: rowPnl };
    }).sort((a, b) => a.username.localeCompare(b.username));
  }, [viewedBetEntries, users, winNum]);

  const partnerPnlRows = useMemo(() => {
    const byPartner: Record<string, { gross: number; winGross: number }> = {};
    viewedPartnerShares.forEach(ps => {
      const agg = byPartner[ps.partnerId] ?? (byPartner[ps.partnerId] = { gross: 0, winGross: 0 });
      agg.gross += ps.sharedAmount;
      if (winNum && ps.number === winNum) agg.winGross += ps.sharedAmount;
    });
    return partners.map(p => {
      const agg = byPartner[p.id] ?? { gross: 0, winGross: 0 };
      const commission = agg.gross * (p.commissionRate ?? 0) / 100;
      const net = agg.gross - commission;
      const payout = winNum ? agg.winGross * (p.payoutRate ?? 0) : 0;
      const rowPnl = winNum ? net - payout : null;
      return { id: p.id, username: p.username, gross: agg.gross, commission, net, heldOnWin: agg.winGross, payoutRate: p.payoutRate ?? 0, payout, pnl: rowPnl };
    }).sort((a, b) => a.username.localeCompare(b.username));
  }, [viewedPartnerShares, partners, winNum]);

  const reportText = useMemo(() => {
    const lines: string[] = [];
    const label = viewedSession?.label ?? session.label;
    const openedAt = viewedSession?.openedAt ?? session.openedAt;
    lines.push(`Session Report — ${label} — ${new Date(openedAt).toLocaleDateString()}`);
    lines.push(`Winning Number: ${winNum ?? 'Not set'}`);
    lines.push('─'.repeat(40));
    lines.push('TOTAL BETS (index = value)');
    lines.push(rows.length > 0 ? formatIndexValueLines(rows.map(r => ({ number: r.number, amount: r.total })), 'index') : '(none)');
    const overRows = rows.filter(r => r.overLimit > 0).map(r => ({ number: r.number, amount: r.overLimit }));
    if (overRows.length > 0) {
      lines.push('─'.repeat(40));
      lines.push('OVER LIMIT (index = value)');
      lines.push(formatIndexValueLines(overRows, 'index'));
    }
    const sharedRows = rows.filter(r => r.shared > 0).map(r => ({ number: r.number, amount: r.shared }));
    if (sharedRows.length > 0) {
      lines.push('─'.repeat(40));
      lines.push('SHARED TO PARTNERS (index = value)');
      lines.push(formatIndexValueLines(sharedRows, 'index'));
    }
    lines.push('─'.repeat(40));
    lines.push('ADMIN P&L');
    lines.push(`Gross Intake: ${fmt(gross)}`);
    lines.push(`Commission Total: ${fmt(Math.round(commTotal))}`);
    lines.push(`Net Intake: ${fmt(Math.round(net))}`);
    lines.push(`Payout${adminPayoutDetail ? ` (${adminPayoutDetail})` : ''}: ${winNum ? fmt(payout) : '—'}`);
    lines.push(`Net P&L: ${winNum ? `${pnl >= 0 ? '+' : ''}${fmt(Math.round(pnl))}` : '—'}`);

    lines.push('─'.repeat(40));
    lines.push('USER P&L');
    if (userPnlRows.length === 0) {
      lines.push('(no users)');
    } else {
      userPnlRows.forEach(r => {
        const detail = formatPayoutDetail(winNum, r.heldOnWin, r.payoutRate);
        lines.push(`${r.username}: gross ${fmt(r.gross)}, comm -${fmt(Math.round(r.commission))}, net ${fmt(Math.round(r.net))}, payout${detail ? ` (${detail})` : ''} ${r.pnl !== null ? fmt(r.payout) : '—'}, P&L ${r.pnl !== null ? `${r.pnl >= 0 ? '+' : ''}${fmt(Math.round(r.pnl))}` : '—'}`);
      });
    }

    lines.push('─'.repeat(40));
    lines.push('PARTNER P&L');
    if (partnerPnlRows.length === 0) {
      lines.push('(no partners)');
    } else {
      partnerPnlRows.forEach(r => {
        const detail = formatPayoutDetail(winNum, r.heldOnWin, r.payoutRate);
        lines.push(`${r.username}: gross ${fmt(r.gross)}, comm -${fmt(Math.round(r.commission))}, net ${fmt(Math.round(r.net))}, payout${detail ? ` (${detail})` : ''} ${r.pnl !== null ? fmt(r.payout) : '—'}, P&L ${r.pnl !== null ? `${r.pnl >= 0 ? '+' : ''}${fmt(Math.round(r.pnl))}` : '—'}`);
      });
    }

    return lines.join('\n');
  }, [rows, session, viewedSession, winNum, gross, commTotal, net, payout, pnl, adminPayoutDetail, userPnlRows, partnerPnlRows]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      setCopied(true);
      toast.success('Report copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copy failed — please select and copy manually');
    }
  };

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p style={{ color: C.text, fontSize: 15, fontWeight: 700 }}>Session Report</p>
          <p style={{ color: C.textMuted, fontSize: 12 }}>{viewedSession?.label ?? session.label} · {rows.length} numbers with entries</p>
        </div>
        <button onClick={copy}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl transition-all"
          style={{
            background: copied ? C.greenBg : C.goldGrad,
            color: copied ? C.greenText : '#000',
            border: copied ? `1px solid ${C.green}44` : 'none',
            cursor: 'pointer', fontSize: 13, fontWeight: 700,
          }}>
          {copied ? <CheckCheck size={15} /> : <Copy size={15} />}
          {copied ? 'Copied!' : 'Copy Report'}
        </button>
      </div>

      {/* Session picker */}
      <div className="rounded-xl p-4 flex items-center gap-3 flex-wrap" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <CalendarClock size={14} color={C.textDim} />
        <span style={{ color: C.textMuted, fontSize: 12, fontWeight: 600 }}>Session:</span>
        <select
          value={selectedSessionId}
          onChange={e => setSelectedSessionId(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, outline: 'none', background: C.card2, border: `1px solid ${C.border}`, color: C.text, fontSize: 13, flex: 1, minWidth: 180 }}>
          <option value="">{session.label} (current)</option>
          {allSessions.filter(s => s.id !== session.id).map(s => (
            <option key={s.id} value={s.id}>{s.label} — {s.status}{s.winningNumber ? ` — #${s.winningNumber}` : ''}</option>
          ))}
        </select>
      </div>

      {/* Preview table */}
      <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <div className="px-5 py-3" style={{ borderBottom: `1px solid ${C.border}`, background: C.card2 }}>
          <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em' }}>REPORT PREVIEW</p>
        </div>
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: C.card2 }}>
              <tr>
                {['NUM', 'TOTAL BETS', 'OVER LIMIT', 'SHARED TO PARTNERS'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', color: C.textDim, fontSize: 11, letterSpacing: '0.06em', textAlign: h === 'NUM' ? 'left' : 'right' as any }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingHistory ? (
                <tr>
                  <td colSpan={4} style={{ padding: '32px 14px', textAlign: 'center', color: C.textDim, fontSize: 13 }}>
                    Loading…
                  </td>
                </tr>
              ) : rows.map(r => (
                <tr key={r.number} style={{ borderTop: `1px solid ${C.borderSubtle}` }}>
                  <td style={{ padding: '9px 14px' }}>
                    <span style={{ color: C.gold, fontSize: 15, fontWeight: 700 }}>{r.number}</span>
                  </td>
                  <td style={{ padding: '9px 14px', textAlign: 'right' }}>
                    <span style={{ color: C.text, fontSize: 13 }}>{fmt(r.total)}</span>
                  </td>
                  <td style={{ padding: '9px 14px', textAlign: 'right' }}>
                    <span style={{ color: r.overLimit > 0 ? C.orangeText : C.textDim, fontSize: 13 }}>
                      {r.overLimit > 0 ? fmt(r.overLimit) : '—'}
                    </span>
                  </td>
                  <td style={{ padding: '9px 14px', textAlign: 'right' }}>
                    <span style={{ color: r.shared > 0 ? C.blueText : C.textDim, fontSize: 13 }}>
                      {r.shared > 0 ? fmt(r.shared) : '—'}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: '32px 14px', textAlign: 'center', color: C.textDim, fontSize: 13 }}>
                    No bet entries yet for this session
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Summary footer — Admin's own P&L */}
        <div className="px-5 py-4 space-y-2" style={{ borderTop: `1px solid ${C.border}`, background: C.card2 }}>
          <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 4 }}>ADMIN P&L</p>
          {[
            { label: 'Gross Intake', val: fmt(gross), color: C.text },
            { label: 'Commission Total', val: `-${fmt(Math.round(commTotal))}`, color: C.orangeText },
            { label: 'Net Intake', val: fmt(Math.round(net)), color: C.blueText },
            { label: `Payout${adminPayoutDetail ? ` (${adminPayoutDetail})` : ''}`, val: winNum ? `-${fmt(payout)}` : '—', color: C.redText },
            { label: 'Net P&L', val: winNum ? `${pnl >= 0 ? '+' : ''}${fmt(Math.round(pnl))}` : '—', color: pnl >= 0 ? C.greenText : C.redText },
          ].map((row, i) => (
            <div key={i} className="flex justify-between">
              <span style={{ color: C.textMuted, fontSize: 13 }}>{row.label}</span>
              <span style={{ color: row.color, fontSize: 13, fontWeight: i === 4 ? 800 : 600 }}>{row.val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* User P&L + Partner P&L */}
      <PnlTable title={`USER P&L — ${userPnlRows.length} MANAGED`} rows={userPnlRows} loading={loadingHistory} winNum={winNum} />
      <PnlTable title={`PARTNER P&L — ${partnerPnlRows.length} MANAGED`} rows={partnerPnlRows} loading={loadingHistory} winNum={winNum} />

      {/* Plain text preview */}
      <div className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 10 }}>PLAIN TEXT (index = value)</p>
        <pre style={{ color: C.textMuted, fontSize: 11, lineHeight: 1.6, overflowX: 'auto', whiteSpace: 'pre', fontFamily: 'monospace' }}>
          {reportText}
        </pre>
      </div>
    </div>
  );
}
