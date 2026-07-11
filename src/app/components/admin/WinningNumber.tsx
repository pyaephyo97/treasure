import { useState, useMemo } from 'react';
import { Trophy, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '../../context';
import { C } from '../../theme';

function PnLRow({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <div className="flex justify-between items-center py-2" style={{ borderBottom: `1px solid ${C.borderSubtle}` }}>
      <span style={{ color: C.textMuted, fontSize: 13 }}>{label}</span>
      <span style={{ color: color ?? C.text, fontSize: 13, fontWeight: bold ? 700 : 500 }}>{value}</span>
    </div>
  );
}

export function WinningNumber() {
  const { session, setWinningNumber, users, betEntries, partners, partnerShares, adminPnl } = useApp();
  const [input, setInput] = useState('');
  const [confirm, setConfirm] = useState(false);
  // When a winning number is already locked in, "Change Number" reveals the
  // input box (prefilled with the current number) instead of jumping
  // straight to the confirm modal — previously that modal opened with
  // whatever stale/empty `input` was left over from the last set, which is
  // why "Change Number" appeared to error out / silently fail to replace it.
  const [editing, setEditing] = useState(false);

  const handleSet = async () => {
    if (!input || !/^\d{1,2}$/.test(input)) {
      toast.error('Enter a valid number (00–99)'); return;
    }
    const n = input.padStart(2, '0');
    if (parseInt(n, 10) > 99) {
      toast.error('Enter a valid number (00–99)'); return;
    }
    const { error } = await setWinningNumber(n);
    if (error) { toast.error(error); return; }
    toast.success(`Winning number set to #${n}`);
    setConfirm(false);
    setEditing(false);
    setInput('');
  };

  const winNum = session.winningNumber;
  const showInputForm = !winNum || editing;

  const userPnLs = useMemo(() => {
    if (!winNum) return [];
    return users.filter(u => u.isActive).map(u => {
      const gross = betEntries.filter(e => e.userId === u.id).reduce((s, e) => s + e.amount, 0);
      const commission = gross * u.commissionRate / 100;
      const net = gross - commission;
      const heldOnWin = betEntries.filter(e => e.userId === u.id && e.number === winNum).reduce((s, e) => s + e.amount, 0);
      const payout = heldOnWin * u.payoutRate;
      return { account: u, gross, commission, net, heldOnWin, payout, pnl: net - payout };
    });
  }, [winNum, users, betEntries]);

  const partnerPnLs = useMemo(() => {
    if (!winNum) return [];
    return partners.filter(p => p.isActive).map(p => {
      const gross = partnerShares.filter(ps => ps.partnerId === p.id).reduce((s, ps) => s + ps.sharedAmount, 0);
      const commission = gross * p.commissionRate / 100;
      const net = gross - commission;
      const heldOnWin = partnerShares.filter(ps => ps.partnerId === p.id && ps.number === winNum).reduce((s, ps) => s + ps.sharedAmount, 0);
      const payout = heldOnWin * p.payoutRate;
      return { account: p, gross, commission, net, heldOnWin, payout, pnl: net - payout };
    });
  }, [winNum, partners, partnerShares]);

  const fmt = (n: number) => n.toLocaleString();
  const fmtPnl = (n: number) => `${n >= 0 ? '+' : ''}${fmt(Math.round(n))}`;

  const inp = { padding: '8px 12px', borderRadius: 8, outline: 'none', background: C.card2, border: `1px solid ${C.border}`, color: C.text, fontSize: 13 };

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Set winning number card */}
      <div className="rounded-2xl p-6" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: C.goldDim }}>
            <Trophy size={18} color={C.gold} />
          </div>
          <div>
            <p style={{ color: C.text, fontSize: 15, fontWeight: 700 }}>Set Winning Number</p>
            <p style={{ color: C.textMuted, fontSize: 12 }}>Session {session.label}</p>
          </div>
        </div>

        {!showInputForm ? (
          <div className="flex flex-col items-center py-6">
            <div className="w-24 h-24 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: C.goldGrad, boxShadow: `0 0 40px ${C.goldDim}` }}>
              <span style={{ fontSize: 36, fontWeight: 900, color: '#000', letterSpacing: '0.05em' }}>{winNum}</span>
            </div>
            <p style={{ color: C.gold, fontSize: 14, fontWeight: 700 }}>WINNING NUMBER LOCKED</p>
            <p style={{ color: C.textMuted, fontSize: 12, marginTop: 4 }}>P&L calculations are shown below</p>
            {/* Always available (open or closed) — entered incorrectly? Fix it any time. */}
            <button onClick={() => { setInput(winNum ?? ''); setEditing(true); }} className="mt-4 px-4 py-2 rounded-lg"
              style={{ background: C.card2, color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 12 }}>
              Change Number
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-3 rounded-xl flex items-center gap-2" style={{ background: C.orangeBg }}>
              <AlertTriangle size={14} color={C.orange} />
              <p style={{ color: C.orangeText, fontSize: 12 }}>
                This is a global action — once {editing ? 'changed' : 'set'}, it triggers P&L for all accounts immediately.
              </p>
            </div>
            {!editing && session.status === 'open' && (
              <div className="p-3 rounded-xl flex items-center gap-2" style={{ background: C.card2 }}>
                <p style={{ color: C.textDim, fontSize: 11 }}>
                  Tip: winning numbers are normally set after closing the session — but you can set it early if needed.
                </p>
              </div>
            )}
            <div className="flex gap-3">
              <input
                type="text"
                maxLength={2}
                value={input}
                onChange={e => setInput(e.target.value.replace(/\D/g, ''))}
                placeholder="00–99"
                autoFocus
                style={{ ...inp, flex: 1, fontSize: 24, fontWeight: 700, textAlign: 'center', letterSpacing: '0.1em' }}
              />
              <button onClick={() => { if (!input) { toast.error('Enter a number'); return; } setConfirm(true); }}
                className="px-6 py-3 rounded-xl"
                style={{ background: C.goldGrad, color: '#000', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 800 }}>
                {editing ? 'Update Number' : 'Set Number'}
              </button>
            </div>
            {editing && (
              <button onClick={() => { setEditing(false); setInput(''); }}
                className="w-full py-2 rounded-lg"
                style={{ background: 'none', color: C.textDim, border: `1px solid ${C.borderSubtle}`, cursor: 'pointer', fontSize: 12 }}>
                Cancel
              </button>
            )}
          </div>
        )}
      </div>

      {/* Confirm modal */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <h2 style={{ color: C.text, fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
              Confirm Winning Number
            </h2>
            <p style={{ color: C.textMuted, fontSize: 13, marginBottom: 6 }}>
              You are setting the winning number to:
            </p>
            <div className="flex justify-center my-5">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: C.goldGrad }}>
                <span style={{ fontSize: 28, fontWeight: 900, color: '#000' }}>{input.padStart(2, '0')}</span>
              </div>
            </div>
            <p style={{ color: C.redText, fontSize: 12, marginBottom: 20, textAlign: 'center' }}>
              This action is permanent and will trigger P&L calculations for all accounts.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirm(false)} className="flex-1 py-2.5 rounded-lg"
                style={{ background: C.card2, color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 13 }}>
                Cancel
              </button>
              <button onClick={handleSet} className="flex-1 py-2.5 rounded-lg"
                style={{ background: C.goldGrad, color: '#000', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin P&L (via calculate_pnl RPC — server-authoritative) */}
      {adminPnl && adminPnl.winningNumberSet && (
        <div className="rounded-2xl p-6" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 14 }}>
            ADMIN P&L — WINNING #{winNum}
          </p>
          <PnLRow label="Gross Intake" value={fmt(adminPnl.grossIntake)} />
          <PnLRow label="Commission Total" value={`-${fmt(Math.round(adminPnl.commissionTotal))}`} color={C.orangeText} />
          <PnLRow label="Net Intake" value={fmt(Math.round(adminPnl.netIntake))} color={C.blueText} />
          <PnLRow label="Payout" value={`-${fmt(adminPnl.payout ?? 0)}`} color={C.redText} />
          <div className="flex justify-between items-center pt-3">
            <span style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>NET P&L</span>
            <span style={{ fontSize: 18, fontWeight: 800, color: (adminPnl.netPnl ?? 0) >= 0 ? C.greenText : C.redText }}>
              {fmtPnl(adminPnl.netPnl ?? 0)}
            </span>
          </div>
        </div>
      )}

      {/* User P&Ls */}
      {userPnLs.length > 0 && (
        <div className="space-y-3">
          <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', paddingLeft: 2 }}>
            USER P&L — WINNING #{winNum}
          </p>
          {userPnLs.map(({ account, gross, commission, net, payout, pnl }) => (
            <div key={account.id} className="rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 10 }}>
                USER: {account.username.toUpperCase()}
              </p>
              {gross === 0 ? (
                <p style={{ color: C.textDim, fontSize: 13 }}>No bet entries — no P&L to show.</p>
              ) : (
                <>
                  <PnLRow label="Gross Bets" value={fmt(gross)} />
                  <PnLRow label={`Commission (${account.commissionRate}%)`} value={`-${fmt(Math.round(commission))}`} color={C.orangeText} />
                  <PnLRow label="Net Intake" value={fmt(Math.round(net))} color={C.blueText} />
                  <PnLRow label={`Payout on #${winNum}`} value={`-${fmt(payout)}`} color={C.redText} />
                  <div className="flex justify-between items-center pt-3">
                    <span style={{ color: C.text, fontSize: 13, fontWeight: 700 }}>NET P&L</span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: pnl >= 0 ? C.greenText : C.redText }}>
                      {fmtPnl(pnl)}
                    </span>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Partner P&Ls */}
      {partnerPnLs.length > 0 && (
        <div className="space-y-3">
          <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', paddingLeft: 2 }}>
            PARTNER P&L — WINNING #{winNum}
          </p>
          {partnerPnLs.map(({ account, gross, commission, net, payout, pnl }) => (
            <div key={account.id} className="rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 10 }}>
                PARTNER: {account.username.toUpperCase()}
              </p>
              {gross === 0 ? (
                <p style={{ color: C.textDim, fontSize: 13 }}>No data received — no P&L to show.</p>
              ) : (
                <>
                  <PnLRow label="Gross Received" value={fmt(gross)} />
                  <PnLRow label={`Commission (${account.commissionRate}%)`} value={`-${fmt(Math.round(commission))}`} color={C.orangeText} />
                  <PnLRow label="Net Intake" value={fmt(Math.round(net))} color={C.blueText} />
                  <PnLRow label={`Payout on #${winNum}`} value={`-${fmt(payout)}`} color={C.redText} />
                  <div className="flex justify-between items-center pt-3">
                    <span style={{ color: C.text, fontSize: 13, fontWeight: 700 }}>NET P&L</span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: pnl >= 0 ? C.greenText : C.redText }}>
                      {fmtPnl(pnl)}
                    </span>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
