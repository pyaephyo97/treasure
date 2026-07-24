import { useMemo } from 'react';
import { Users, Handshake, Activity, AlertTriangle, Share2, DollarSign } from 'lucide-react';
import { useApp } from '../../context';
import { C } from '../../theme';
import { formatPayoutDetail } from '../../utils/format';

function StatCard({ icon: Icon, label, value, sub, color, bg }: {
  icon: any; label: string; value: string; sub?: string; color: string; bg: string;
}) {
  return (
    <div className="rounded-xl p-4 flex items-start gap-4"
      style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
        <Icon size={18} color={color} />
      </div>
      <div className="min-w-0">
        <p style={{ color: C.textDim, fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 2 }}>{label}</p>
        <p style={{ color: C.text, fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>{value}</p>
        {sub && <p style={{ color: C.textMuted, fontSize: 11, marginTop: 2 }}>{sub}</p>}
      </div>
    </div>
  );
}

export function Dashboard() {
  const { users, partners, betEntries, session, partnerShares, adminPnl, myProfile } = useApp();

  const activeUsers = users.filter(u => u.isActive).length;
  const activePartners = partners.filter(p => p.isActive).length;
  const totalAmount = useMemo(() => betEntries.reduce((s, e) => s + e.amount, 0), [betEntries]);

  const byNumber = useMemo(() => {
    const m: Record<string, number> = {};
    betEntries.forEach(e => { m[e.number] = (m[e.number] || 0) + e.amount; });
    return m;
  }, [betEntries]);

  // Matches the persisted threshold from the Total Data page (session.totalDataSetLimit),
  // not a hardcoded guess — keeps this stat consistent with what was actually configured.
  const overLimitThreshold = session.totalDataSetLimit ?? 5000;
  const overLimitTotal = useMemo(() =>
    Object.values(byNumber).reduce((s, v) => s + Math.max(0, v - overLimitThreshold), 0),
    [byNumber, overLimitThreshold]
  );

  const totalShared = useMemo(() => partnerShares.reduce((s, ps) => s + ps.sharedAmount, 0), [partnerShares]);

  // Fallback figures for the brief window before calculate_pnl resolves (or
  // if it errors) — prefer adminPnl (server-authoritative, via the
  // calculate_pnl RPC) whenever it's available. Commission is the ADMIN's
  // own rate applied to gross intake (matching calculate_pnl), not a sum of
  // each managed user's individual commission rate.
  const localCommissionTotal = useMemo(() =>
    totalAmount * (myProfile?.commissionRate ?? 0) / 100,
    [totalAmount, myProfile?.commissionRate]
  );

  const winNum = session.winningNumber;
  const commissionTotal = adminPnl?.commissionTotal ?? localCommissionTotal;
  const netIntake = adminPnl?.netIntake ?? (totalAmount - localCommissionTotal);
  const payout = adminPnl?.payout ?? 0;
  const pnl = adminPnl?.netPnl ?? 0;

  // Same payout basis calculate_pnl uses for the admin/master_admin branch:
  // bets on the winning number minus whatever was already shared away to
  // partners — shown so the Payout line always says its work.
  const totalSharedOnWin = useMemo(() =>
    winNum ? partnerShares.filter(ps => ps.number === winNum).reduce((s, ps) => s + ps.sharedAmount, 0) : 0,
    [winNum, partnerShares]
  );
  const heldOnWin = winNum ? (byNumber[winNum] || 0) - totalSharedOnWin : 0;
  const payoutDetail = formatPayoutDetail(winNum, heldOnWin, myProfile?.payoutRate ?? 0);

  const fmt = (n: number) => n.toLocaleString();

  const recentEntries = useMemo(() =>
    [...betEntries].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 8),
    [betEntries]
  );

  return (
    <div className="space-y-5">
      {/* Session status */}
      <div className="rounded-xl p-4 flex items-center justify-between"
        style={{
          background: session.status === 'open' ? C.greenBg : C.redBg,
          border: `1px solid ${session.status === 'open' ? C.green : C.red}44`,
        }}>
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: session.status === 'open' ? C.green : C.red }} />
          <div>
            <span style={{ color: session.status === 'open' ? C.greenText : C.redText, fontWeight: 700, fontSize: 13 }}>
              SESSION {session.status.toUpperCase()}
            </span>
            <span style={{ color: C.textMuted, fontSize: 12, marginLeft: 10 }}>
              {session.label} · Opened {new Date(session.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>
        {winNum && (
          <div className="px-3 py-1 rounded-lg" style={{ background: C.goldDim }}>
            <span style={{ color: C.gold, fontSize: 12, fontWeight: 700 }}>WIN: #{winNum}</span>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard icon={Users} label="ACTIVE USERS" value={String(activeUsers)} color={C.green} bg={C.greenBg} />
        <StatCard icon={Handshake} label="ACTIVE PARTNERS" value={String(activePartners)} color={C.purple} bg={C.purpleBg} />
        <StatCard icon={Activity} label="TOTAL BET AMOUNT" value={fmt(totalAmount)} sub={`${betEntries.length} entries`} color={C.blue} bg={C.blueBg} />
        <StatCard icon={AlertTriangle} label="OVER LIMIT TOTAL" value={fmt(overLimitTotal)} sub={`vs ${fmt(overLimitThreshold)} threshold`} color={C.orange} bg={C.orangeBg} />
        <StatCard icon={Share2} label="SHARED TO PARTNERS" value={fmt(totalShared)} sub={totalShared > 0 ? 'Distributed' : 'Not yet distributed'} color={C.purple} bg={C.purpleBg} />
        <StatCard
          icon={DollarSign}
          label="NET P&L"
          value={winNum ? `${pnl >= 0 ? '+' : ''}${fmt(Math.round(pnl))}` : 'Pending'}
          sub={winNum ? `Payout: ${fmt(payout)}` : 'Set winning number to calculate'}
          color={!winNum ? C.textDim : pnl >= 0 ? C.green : C.red}
          bg={!winNum ? C.card2 : pnl >= 0 ? C.greenBg : C.redBg}
        />
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* P&L breakdown */}
        <div className="rounded-xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 14 }}>P&L BREAKDOWN</p>
          {[
            { label: 'Gross Intake', val: fmt(totalAmount), color: C.text },
            { label: 'Commission Total', val: `-${fmt(Math.round(commissionTotal))}`, color: C.orangeText },
            { label: 'Net Intake', val: fmt(Math.round(netIntake)), color: C.blueText },
            { label: `Payout${payoutDetail ? ` (${payoutDetail})` : ''}`, val: winNum ? `-${fmt(payout)}` : '—', color: C.redText },
            { label: 'Net P&L', val: winNum ? `${pnl >= 0 ? '+' : ''}${fmt(Math.round(pnl))}` : '—', color: pnl >= 0 ? C.greenText : C.redText },
          ].map((row, i) => (
            <div key={i} className="flex justify-between py-2"
              style={{ borderBottom: i < 4 ? `1px solid ${C.borderSubtle}` : 'none' }}>
              <span style={{ color: C.textMuted, fontSize: 13 }}>{row.label}</span>
              <span style={{ color: row.color, fontSize: 13, fontWeight: i === 4 ? 700 : 500 }}>{row.val}</span>
            </div>
          ))}
        </div>

        {/* Recent entries */}
        <div className="rounded-xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 14 }}>RECENT ENTRIES</p>
          <div className="space-y-2">
            {recentEntries.map(e => {
              const u = users.find(x => x.id === e.userId);
              return (
                <div key={e.id} className="flex items-center justify-between px-3 py-2 rounded-lg"
                  style={{ background: C.card2 }}>
                  <div className="flex items-center gap-3">
                    <span className="w-9 h-6 rounded flex items-center justify-center"
                      style={{ background: C.goldDim, color: C.gold, fontSize: 14, fontWeight: 700 }}>
                      {e.number}
                    </span>
                    <span style={{ color: C.textMuted, fontSize: 12 }}>{u?.username}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span style={{ color: C.text, fontSize: 12, fontWeight: 600 }}>{e.amount.toLocaleString()}</span>
                    <span style={{ color: C.textDim, fontSize: 11 }}>
                      {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
