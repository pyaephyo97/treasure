import { useState, useMemo, useEffect } from 'react';
import { ArrowUpDown, Share2, X, CheckCircle, Copy, CheckCheck, History as HistoryIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '../../context';
import { C } from '../../theme';
import type { DistributionResult, ShareMethod } from '../../types';
import { formatIndexValueLines, copyToClipboard, type IndexValueSort } from '../../utils/format';

type SortMode = IndexValueSort;

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <div className="w-full max-w-lg rounded-2xl p-6" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between mb-4">
          <h2 style={{ color: C.text, fontSize: 16, fontWeight: 700 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer' }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function TotalData() {
  const { session, betEntries, users, partners, partnerShares, shareHistory, previewDistribution, confirmDistribution, setTotalDataSetLimit } = useApp();
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(users.map(u => u.id));
  const [sort, setSort] = useState<SortMode>('value');
  // The threshold is persisted on the session row (sessions.total_data_set_limit)
  // rather than kept as local-only state — it used to silently reset to a
  // hardcoded 5000 default on every reload/navigation even after "Apply".
  const limitThreshold = session.totalDataSetLimit ?? 5000;
  const [limitInput, setLimitInput] = useState(String(limitThreshold));
  const [applyingLimit, setApplyingLimit] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareMethod, setShareMethod] = useState<ShareMethod>('percentage');
  const [overSort, setOverSort] = useState<SortMode>('value');
  const [serverPreview, setServerPreview] = useState<DistributionResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copiedWithin, setCopiedWithin] = useState(false);
  const [copiedOver, setCopiedOver] = useState(false);
  const [copiedHistoryId, setCopiedHistoryId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const toggleUser = (id: string) => {
    setSelectedUserIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Keep the input box's text in sync with the persisted value — e.g. when
  // a new session opens (resets to null -> 5000) or another admin applies a
  // different threshold. Only resyncs from the server value, never fights
  // with what's currently being typed mid-edit.
  useEffect(() => {
    setLimitInput(String(session.totalDataSetLimit ?? 5000));
  }, [session.id, session.totalDataSetLimit]);

  const applyLimitThreshold = async () => {
    const v = parseInt(limitInput);
    if (isNaN(v) || v < 0) { toast.error('Enter a valid limit value'); return; }
    setApplyingLimit(true);
    const { error } = await setTotalDataSetLimit(v);
    setApplyingLimit(false);
    if (error) { toast.error(error); return; }
    toast.success('Limit threshold applied');
  };

  const totalByNumber = useMemo(() => {
    const m: Record<string, number> = {};
    betEntries
      .filter(e => selectedUserIds.includes(e.userId))
      .forEach(e => { m[e.number] = (m[e.number] || 0) + e.amount; });
    return m;
  }, [betEntries, selectedUserIds]);

  const allRows = useMemo(() =>
    Array.from({ length: 100 }, (_, i) => {
      const num = String(i).padStart(2, '0');
      return { number: num, total: totalByNumber[num] || 0 };
    }),
    [totalByNumber]
  );

  // Cumulative over-limit amount already recorded (across every confirmed
  // Share-to-Partners action this session), per number — this is what makes
  // a number "cut off" from the live Over Limit panel once it's been shared:
  // once the full over-limit amount for a number has been captured in
  // History, there's nothing left outstanding to distribute for it.
  const alreadyHandledByNumber = useMemo(() => {
    const m: Record<string, number> = {};
    shareHistory.forEach(entry => {
      entry.overLimitRecords.forEach(r => {
        m[r.number] = (m[r.number] || 0) + r.overLimitAmount;
      });
    });
    return m;
  }, [shareHistory]);

  // Left panel: EVERY number with bets, shown capped at the limit, minus
  // whatever has already been shared away to partners this session — once a
  // number's excess is captured by a confirmed share action it's cut from
  // Total Data for good, even if the threshold is raised afterward (e.g.
  // total=700, limit=500 → 200 shared to partners; admin later raises the
  // limit to 10000 → Within Limit must still show only 500, not 700, since
  // that 200 already left and belongs to the partner now, not the admin).
  const withinLimitRows = useMemo(() => {
    const rows = allRows
      .map(r => {
        const effective = Math.max(0, r.total - (alreadyHandledByNumber[r.number] || 0));
        return { number: r.number, total: Math.min(effective, limitThreshold) };
      })
      .filter(r => r.total > 0);
    return sort === 'index'
      ? [...rows].sort((a, b) => a.number.localeCompare(b.number))
      : [...rows].sort((a, b) => b.total - a.total);
  }, [allRows, sort, limitThreshold, alreadyHandledByNumber]);

  // Right panel: the REMAINING over-limit amount not yet captured by a
  // confirmed share action. Once fully shared, a number's remaining amount
  // drops to 0 and it disappears from this panel — the full record stays
  // visible (and copyable) under History instead.
  const overLimitRows = useMemo(() => {
    const rows = allRows
      .map(r => {
        const rawOver = Math.max(0, r.total - limitThreshold);
        const remaining = Math.max(0, rawOver - (alreadyHandledByNumber[r.number] || 0));
        return { number: r.number, overLimit: remaining };
      })
      .filter(r => r.overLimit > 0);
    return overSort === 'index'
      ? [...rows].sort((a, b) => a.number.localeCompare(b.number))
      : [...rows].sort((a, b) => b.overLimit - a.overLimit);
  }, [allRows, limitThreshold, overSort, alreadyHandledByNumber]);

  const withinTotal = withinLimitRows.reduce((s, r) => s + r.total, 0);
  const overLimitTotal = overLimitRows.reduce((s, r) => s + r.overLimit, 0);

  const activePartners = useMemo(() => partners.filter(p => p.isActive), [partners]);
  const shareSum = activePartners.reduce((s, p) => s + p.sharePercentage, 0);
  const canShare = shareMethod === 'equally' || Math.abs(shareSum - 100) < 0.01;

  // The confirmation breakdown comes from the server (distribute_over_limit
  // RPC, dry-run) rather than being recomputed client-side, since only the
  // server knows how much of each number's over-limit has already been
  // handled by prior share actions this session.
  useEffect(() => {
    if (!showShareModal) { setServerPreview(null); return; }
    let cancelled = false;
    setPreviewLoading(true);
    const partnerIds = shareMethod === 'equally' ? activePartners.map(p => p.id) : undefined;
    previewDistribution(shareMethod, limitThreshold, partnerIds).then(({ result, error }) => {
      if (cancelled) return;
      setPreviewLoading(false);
      if (error) { toast.error(error); setServerPreview(null); return; }
      setServerPreview(result ?? null);
    });
    return () => { cancelled = true; };
  }, [showShareModal, shareMethod, limitThreshold, activePartners, previewDistribution]);

  const breakdownByPartner = useMemo(() => {
    if (!serverPreview) return [];
    const totals = new Map<string, number>();
    serverPreview.breakdown.forEach(b => {
      totals.set(b.partnerId, (totals.get(b.partnerId) ?? 0) + b.sharedAmount);
    });
    return activePartners.map(p => ({ partner: p, total: totals.get(p.id) ?? 0 }));
  }, [serverPreview, activePartners]);

  const confirmShare = async () => {
    if (!canShare) { toast.error('Partner percentages must sum to 100%'); return; }
    setConfirming(true);
    const partnerIds = shareMethod === 'equally' ? activePartners.map(p => p.id) : undefined;
    const { error } = await confirmDistribution(shareMethod, limitThreshold, partnerIds);
    setConfirming(false);
    if (error) { toast.error(error); return; }
    toast.success(`Over-limit data shared to ${activePartners.length} partner(s)`);
    setShowShareModal(false);
  };

  const alreadyShared = partnerShares.length > 0;

  const copyWithinLimit = async () => {
    const text = formatIndexValueLines(withinLimitRows.map(r => ({ number: r.number, amount: r.total })), sort);
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
    setCopiedOver(true);
    toast.success('Over-limit table copied');
    setTimeout(() => setCopiedOver(false), 2000);
  };

  const copyHistoryEntry = async (entryId: string) => {
    const entry = shareHistory.find(h => h.id === entryId);
    if (!entry) return;
    const text = formatIndexValueLines(
      entry.overLimitRecords.map(r => ({ number: r.number, amount: r.overLimitAmount })),
      'index'
    );
    const ok = await copyToClipboard(text);
    if (!ok) { toast.error('Copy failed'); return; }
    setCopiedHistoryId(entryId);
    toast.success('History entry copied');
    setTimeout(() => setCopiedHistoryId(null), 2000);
  };

  // fontSize 16 is the iOS Safari auto-zoom threshold — anything smaller
  // makes the whole page zoom in when the field is focused on a phone.
  const inp = { padding: '8px 12px', borderRadius: 8, outline: 'none', background: C.card2, border: `1px solid ${C.border}`, color: C.text, fontSize: 16 };

  return (
    <div className="space-y-4">
      {/* User filter */}
      <div className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 10 }}>FILTER BY USER</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedUserIds(users.map(u => u.id))}
            className="px-3 py-1.5 rounded-lg"
            style={{
              background: selectedUserIds.length === users.length ? C.goldDim : C.card2,
              color: selectedUserIds.length === users.length ? C.gold : C.textMuted,
              border: `1px solid ${selectedUserIds.length === users.length ? C.borderBright : C.borderSubtle}`,
              fontSize: 12, cursor: 'pointer',
            }}>All Users</button>
          {users.map(u => (
            <button key={u.id} onClick={() => toggleUser(u.id)}
              className="px-3 py-1.5 rounded-lg transition-all"
              style={{
                background: selectedUserIds.includes(u.id) ? C.greenBg : C.card2,
                color: selectedUserIds.includes(u.id) ? C.greenText : C.textMuted,
                border: `1px solid ${selectedUserIds.includes(u.id) ? C.green + '44' : C.borderSubtle}`,
                fontSize: 12, cursor: 'pointer',
              }}>{u.username}</button>
          ))}
        </div>
      </div>

      {/* Limit input */}
      {/* flex-wrap lets the input+button drop to their own row on narrow
          phones instead of squeezing next to the description text; minWidth:
          0 on the input stops WebKit from refusing to shrink it below its
          native intrinsic width, which is what was forcing this whole row
          (and the page) wider than the viewport. */}
      <div className="rounded-xl p-4 flex items-center gap-4 flex-wrap" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <div style={{ minWidth: 200, flex: 1 }}>
          <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 4 }}>LIMIT THRESHOLD</p>
          <p style={{ color: C.textMuted, fontSize: 11 }}>Numbers exceeding this will appear in the Over Limit table</p>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <input
            type="text"
            inputMode="numeric"
            value={limitInput}
            onChange={e => setLimitInput(e.target.value.replace(/\D/g, ''))}
            style={{ ...inp, width: 110, minWidth: 0 }}
          />
          <button onClick={applyLimitThreshold} disabled={applyingLimit}
            className="whitespace-nowrap"
            style={{
              background: C.goldGrad, color: '#000', border: 'none', flexShrink: 0,
              cursor: applyingLimit ? 'not-allowed' : 'pointer', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
            }}>
            {applyingLimit ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>

      {/* Two panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Within Limit */}
        <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
            <div>
              <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em' }}>WITHIN LIMIT</p>
              <p style={{ color: C.textDim, fontSize: 10, marginTop: 1 }}>capped at {limitThreshold.toLocaleString()}</p>
            </div>
            <button onClick={() => setSort(s => s === 'index' ? 'value' : 'index')}
              className="flex items-center gap-1 px-2 py-1 rounded-lg"
              style={{ background: C.card2, color: C.textMuted, border: 'none', cursor: 'pointer', fontSize: 11 }}>
              <ArrowUpDown size={11} /> {sort === 'index' ? 'Index ↑' : 'Value ↓'}
            </button>
          </div>
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: C.card2 }}>
                <tr>
                  <th style={{ padding: '8px 14px', textAlign: 'left', color: C.textDim, fontSize: 11, letterSpacing: '0.06em' }}>NUM</th>
                  <th style={{ padding: '8px 14px', textAlign: 'right', color: C.textDim, fontSize: 11, letterSpacing: '0.06em' }}>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {withinLimitRows.length === 0 ? (
                  <tr><td colSpan={2} style={{ padding: '24px 14px', textAlign: 'center', color: C.textDim, fontSize: 12 }}>No numbers within limit</td></tr>
                ) : withinLimitRows.map(r => (
                  <tr key={r.number} style={{ borderTop: `1px solid ${C.borderSubtle}` }}>
                    <td style={{ padding: '8px 14px' }}>
                      <span style={{ color: C.gold, fontSize: 15, fontWeight: 700 }}>{r.number}</span>
                    </td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                      <span style={{ color: C.greenText, fontSize: 13 }}>{r.total.toLocaleString()}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 space-y-3" style={{ borderTop: `1px solid ${C.border}` }}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span style={{ color: C.textMuted, fontSize: 12 }}>Within Total</span>
              <span style={{ color: C.textDim, fontSize: 11 }}>Count: {withinLimitRows.length}</span>
              <span style={{ color: C.greenText, fontSize: 13, fontWeight: 700 }}>{withinTotal.toLocaleString()}</span>
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
            <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em' }}>OVER LIMIT</p>
            <button onClick={() => setOverSort(s => s === 'index' ? 'value' : 'index')}
              className="flex items-center gap-1 px-2 py-1 rounded-lg"
              style={{ background: C.card2, color: C.textMuted, border: 'none', cursor: 'pointer', fontSize: 11 }}>
              <ArrowUpDown size={11} /> {overSort === 'index' ? 'Index ↑' : 'Value ↓'}
            </button>
          </div>

          {overLimitRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <CheckCircle size={28} color={C.green} />
              <p style={{ color: C.greenText, fontSize: 13, marginTop: 8 }}>
                {alreadyShared ? 'All over-limit data shared — nothing outstanding' : 'All numbers within threshold'}
              </p>
            </div>
          ) : (
            <>
              <div style={{ maxHeight: 340, overflowY: 'auto' }}>
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
                          <span style={{ color: C.orangeText, fontSize: 13, fontWeight: 700 }}>{r.overLimit.toLocaleString()}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 space-y-3" style={{ borderTop: `1px solid ${C.border}` }}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span style={{ color: C.textMuted, fontSize: 12 }}>Total Over Limit</span>
                  <span style={{ color: C.textDim, fontSize: 11 }}>Count: {overLimitRows.length}</span>
                  <span style={{ color: C.orangeText, fontSize: 13, fontWeight: 700 }}>{overLimitTotal.toLocaleString()}</span>
                </div>
                <button onClick={copyOverLimit}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl"
                  style={{
                    background: copiedOver ? C.greenBg : C.card2,
                    color: copiedOver ? C.greenText : C.textMuted,
                    border: `1px solid ${copiedOver ? C.green + '44' : C.borderSubtle}`,
                    cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  }}>
                  {copiedOver ? <CheckCheck size={13} /> : <Copy size={13} />}
                  {copiedOver ? 'Copied!' : 'Copy (index = value)'}
                </button>
                <button
                  onClick={() => { if (!activePartners.length) { toast.error('No active partners to share with'); return; } setShowShareModal(true); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl"
                  style={{
                    background: alreadyShared ? C.greenBg : C.goldGrad,
                    color: alreadyShared ? C.greenText : '#000',
                    border: alreadyShared ? `1px solid ${C.green}44` : 'none',
                    cursor: 'pointer', fontSize: 13, fontWeight: 700,
                  }}>
                  <Share2 size={14} />
                  {alreadyShared ? 'Redistribute to Partners' : 'Share to Partners'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* History */}
      <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <button onClick={() => setShowHistory(s => !s)}
          className="w-full flex items-center justify-between px-4 py-3"
          style={{ background: 'none', border: 'none', cursor: 'pointer', borderBottom: showHistory ? `1px solid ${C.border}` : 'none' }}>
          <div className="flex items-center gap-2">
            <HistoryIcon size={13} color={C.textDim} />
            <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em' }}>
              SHARE HISTORY ({shareHistory.length})
            </p>
          </div>
          <span style={{ color: C.textDim, fontSize: 11 }}>{showHistory ? 'Hide' : 'Show'}</span>
        </button>
        {showHistory && (
          shareHistory.length === 0 ? (
            <p style={{ color: C.textDim, fontSize: 13, padding: '24px 16px', textAlign: 'center' }}>
              No share actions confirmed yet this session
            </p>
          ) : (
            <div className="divide-y" style={{ borderColor: C.borderSubtle }}>
              {shareHistory.map(entry => (
                <div key={entry.id} className="px-4 py-3 space-y-2" style={{ borderTop: `1px solid ${C.borderSubtle}` }}>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <span style={{ color: C.text, fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>{entry.shareMethod}</span>
                      <span style={{ color: C.textDim, fontSize: 11, marginLeft: 8 }}>
                        limit {entry.setLimit.toLocaleString()} · {entry.overLimitRecords.length} number{entry.overLimitRecords.length !== 1 ? 's' : ''} · {new Date(entry.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span style={{ color: C.orangeText, fontSize: 13, fontWeight: 700 }}>{entry.totalSharedAmount.toLocaleString()}</span>
                      <button onClick={() => copyHistoryEntry(entry.id)}
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
                    {entry.overLimitRecords.map(r => (
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

      {/* Share modal */}
      {showShareModal && (
        <Modal title="Share Over-Limit to Partners" onClose={() => setShowShareModal(false)}>
          <div className="space-y-4">
            <div>
              <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 8 }}>SHARE METHOD</p>
              <div className="grid grid-cols-2 gap-2">
                {(['percentage', 'equally'] as ShareMethod[]).map(m => (
                  <button key={m} onClick={() => setShareMethod(m)}
                    className="py-2.5 rounded-xl capitalize"
                    style={{
                      background: shareMethod === m ? C.goldDim : C.card2,
                      color: shareMethod === m ? C.gold : C.textMuted,
                      border: `1px solid ${shareMethod === m ? C.borderBright : C.borderSubtle}`,
                      fontSize: 13, fontWeight: shareMethod === m ? 700 : 400, cursor: 'pointer',
                    }}>{m}</button>
                ))}
              </div>
            </div>

            {shareMethod === 'percentage' && !canShare && (
              <div className="p-3 rounded-xl" style={{ background: C.redBg }}>
                <p style={{ color: C.redText, fontSize: 12 }}>Partner shares sum to {shareSum}% — must be 100%.</p>
              </div>
            )}

            <div>
              <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 8 }}>BREAKDOWN PER PARTNER</p>
              {previewLoading && (
                <p style={{ color: C.textDim, fontSize: 12, padding: '8px 0' }}>Calculating breakdown…</p>
              )}
              {!previewLoading && serverPreview?.message && (
                <p style={{ color: C.textDim, fontSize: 12, padding: '8px 0' }}>{serverPreview.message}</p>
              )}
              {!previewLoading && breakdownByPartner.map(({ partner, total }) => (
                <div key={partner.id} className="flex items-center justify-between py-2"
                  style={{ borderBottom: `1px solid ${C.borderSubtle}` }}>
                  <div>
                    <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{partner.username}</span>
                    {shareMethod === 'percentage' && (
                      <span style={{ color: C.textDim, fontSize: 11, marginLeft: 6 }}>{partner.sharePercentage}%</span>
                    )}
                  </div>
                  <span style={{ color: C.gold, fontSize: 13, fontWeight: 700 }}>{total.toLocaleString()}</span>
                </div>
              ))}
              <div className="flex justify-between pt-2">
                <span style={{ color: C.textMuted, fontSize: 12 }}>Total shared</span>
                <span style={{ color: C.orangeText, fontSize: 13, fontWeight: 700 }}>
                  {(serverPreview?.totalSharedAmount ?? 0).toLocaleString()}
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowShareModal(false)} className="flex-1 py-2.5 rounded-lg"
                style={{ background: C.card2, color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 13 }}>
                Cancel
              </button>
              <button
                onClick={confirmShare}
                disabled={(!canShare && shareMethod === 'percentage') || previewLoading || confirming}
                className="flex-1 py-2.5 rounded-lg"
                style={{
                  background: canShare ? C.goldGrad : C.card2,
                  color: canShare ? '#000' : C.textDim,
                  border: 'none',
                  cursor: canShare && !previewLoading && !confirming ? 'pointer' : 'not-allowed',
                  fontSize: 13, fontWeight: 700,
                }}>
                {confirming ? 'Sharing…' : 'Confirm & Share'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
