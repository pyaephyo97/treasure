import { useState, useEffect } from 'react';
import { UserCircle, Percent, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '../../context';
import { C } from '../../theme';

export function AdminProfile() {
  const { role, myProfile, setMyAdminRates } = useApp();
  const [commissionInput, setCommissionInput] = useState('0');
  const [payoutInput, setPayoutInput] = useState('0');
  const [applying, setApplying] = useState(false);

  // Keep the inputs in sync with the persisted value — e.g. right after
  // login, or if another tab/session changes these rates (realtime ping).
  // Only resyncs from the server value, never fights with what's currently
  // being typed mid-edit.
  useEffect(() => {
    if (!myProfile) return;
    setCommissionInput(String(myProfile.commissionRate));
    setPayoutInput(String(myProfile.payoutRate));
  }, [myProfile?.commissionRate, myProfile?.payoutRate]);

  const applyRates = async () => {
    const commission = parseFloat(commissionInput);
    const payout = parseFloat(payoutInput);
    if (isNaN(commission) || commission < 0 || commission > 100) { toast.error('Commission must be 0–100'); return; }
    if (isNaN(payout) || payout < 1) { toast.error('Payout must be a positive number'); return; }
    setApplying(true);
    const { error } = await setMyAdminRates(commission, payout);
    setApplying(false);
    if (error) { toast.error(error); return; }
    toast.success('Rates updated');
  };

  const inp = { padding: '10px 12px', borderRadius: 8, outline: 'none', background: C.card2, border: `1px solid ${C.border}`, color: C.text, fontSize: 14, width: '100%' };

  const dirty = myProfile && (commissionInput !== String(myProfile.commissionRate) || payoutInput !== String(myProfile.payoutRate));

  return (
    <div className="space-y-5 max-w-lg">
      {/* Identity card */}
      <div className="rounded-2xl p-6 flex items-center gap-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: C.goldDim }}>
          <UserCircle size={28} color={C.gold} />
        </div>
        <div>
          <p style={{ color: C.text, fontSize: 17, fontWeight: 700 }}>{myProfile?.username ?? '—'}</p>
          <p style={{ color: C.textDim, fontSize: 12, marginTop: 2, textTransform: 'capitalize' }}>
            {role === 'masterAdmin' ? 'Master Admin' : 'Admin'}
          </p>
        </div>
      </div>

      {/* Rates card */}
      <div className="rounded-2xl p-6" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 4 }}>MY RATES</p>
        <p style={{ color: C.textMuted, fontSize: 12, marginBottom: 20 }}>
          Your own commission rate and payout rate — used in your P&amp;L calculations. Only you can change these; adjust them any time.
        </p>

        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <label className="flex items-center gap-1.5" style={{ display: 'flex', color: C.textMuted, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 6 }}>
              <Percent size={11} /> COMMISSION (%)
            </label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={commissionInput}
              onChange={e => setCommissionInput(e.target.value)}
              style={inp}
            />
          </div>
          <div>
            <label className="flex items-center gap-1.5" style={{ display: 'flex', color: C.textMuted, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 6 }}>
              <TrendingUp size={11} /> PAYOUT RATE (×)
            </label>
            <input
              type="number"
              min="1"
              value={payoutInput}
              onChange={e => setPayoutInput(e.target.value)}
              style={inp}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={applyRates} disabled={applying || !dirty}
            className="px-5 py-2.5 rounded-xl"
            style={{
              background: C.goldGrad, color: '#000', border: 'none',
              cursor: (applying || !dirty) ? 'not-allowed' : 'pointer',
              opacity: (applying || !dirty) ? 0.6 : 1,
              fontSize: 13, fontWeight: 700,
            }}>
            {applying ? 'Saving…' : 'Save Changes'}
          </button>
          {myProfile && (
            <span style={{ color: C.textDim, fontSize: 12 }}>
              Currently: {myProfile.commissionRate}% commission · {myProfile.payoutRate}× payout
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
