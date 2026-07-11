import { useState } from 'react';
import { Plus, Pencil, Trash2, UserCheck, UserX, X, Shield, Unlock, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '../../context';
import { C } from '../../theme';
import type { UserAccount, PartnerAccount, AdminAccount } from '../../types';

type Tab = 'users' | 'partners' | 'admins';

// Pure style helper (no component state involved) — hoisted to module scope
// so it isn't reallocated on every render of every row that calls it.
const btn = (color: string, bg: string) => ({
  background: bg, color, border: 'none', cursor: 'pointer',
  padding: '5px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
});

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-md rounded-2xl p-6" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between mb-5">
          <h2 style={{ color: C.text, fontSize: 16, fontWeight: 700 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', color: C.textMuted, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 5 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inp = {
  width: '100%', padding: '8px 12px', borderRadius: 8, outline: 'none',
  background: C.card2, border: `1px solid ${C.border}`, color: C.text, fontSize: 13,
};

const TAB_LABEL: Record<Tab, string> = { users: 'User', partners: 'Partner', admins: 'Admin' };

export function AccountManagement() {
  const { role, users, partners, admins, createAccount, updateAccount, toggleAccountActive, deactivateAccount, toggleUserDataEntry } = useApp();
  const isMasterAdmin = role === 'masterAdmin';
  const [tab, setTab] = useState<Tab>('users');
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<UserAccount | PartnerAccount | AdminAccount | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState({ username: '', password: '', commissionRate: '5', payoutRate: '80', sharePercentage: '50' });

  const openAdd = () => {
    setEditTarget(null);
    setForm({ username: '', password: '', commissionRate: '5', payoutRate: '80', sharePercentage: '50' });
    setShowModal(true);
  };

  const openEdit = (item: UserAccount | PartnerAccount | AdminAccount) => {
    setEditTarget(item);
    setForm({
      username: item.username,
      password: '',
      commissionRate: String(item.commissionRate),
      payoutRate: String(item.payoutRate),
      sharePercentage: tab === 'partners' ? String((item as PartnerAccount).sharePercentage) : '50',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.username.trim()) { toast.error('Username is required'); return; }
    const commission = parseFloat(form.commissionRate);
    const payout = parseFloat(form.payoutRate);
    if (isNaN(commission) || commission < 0 || commission > 100) { toast.error('Commission must be 0–100'); return; }
    if (isNaN(payout) || payout < 1) { toast.error('Payout must be a positive number'); return; }

    if (tab === 'users') {
      if (editTarget) {
        const { error } = await updateAccount(editTarget.id, 'users', {
          username: form.username, commissionRate: commission, payoutRate: payout,
        });
        if (error) { toast.error(error); return; }
        toast.success('User updated');
      } else {
        if (!form.password || form.password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
        const { error } = await createAccount({
          role: 'user', username: form.username, password: form.password,
          commissionRate: commission, payoutRate: payout,
        });
        if (error) { toast.error(error); return; }
        toast.success('User created');
      }
    } else if (tab === 'partners') {
      const share = parseFloat(form.sharePercentage);
      if (isNaN(share) || share < 0 || share > 100) { toast.error('Share % must be 0–100'); return; }
      if (editTarget) {
        const { error } = await updateAccount(editTarget.id, 'partners', {
          username: form.username, commissionRate: commission, payoutRate: payout, sharePercentage: share,
        });
        if (error) { toast.error(error); return; }
        toast.success('Partner updated');
      } else {
        if (!form.password || form.password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
        const { error } = await createAccount({
          role: 'partner', username: form.username, password: form.password,
          commissionRate: commission, payoutRate: payout, sharePercentage: share,
        });
        if (error) { toast.error(error); return; }
        toast.success('Partner created');
      }
    } else {
      // Admins — Master Admin only (also enforced server-side).
      if (editTarget) {
        const { error } = await updateAccount(editTarget.id, 'admins', {
          username: form.username, commissionRate: commission, payoutRate: payout,
        });
        if (error) { toast.error(error); return; }
        toast.success('Admin updated');
      } else {
        if (!form.password || form.password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
        const { error } = await createAccount({
          role: 'admin', username: form.username, password: form.password,
          commissionRate: commission, payoutRate: payout,
        });
        if (error) { toast.error(error); return; }
        toast.success('Admin created');
      }
    }
    setShowModal(false);
  };

  const handleToggle = async (id: string) => {
    const { error } = await toggleAccountActive(id, tab);
    if (error) toast.error(error);
  };

  // Independent of is_active (which fully blocks login): this just opens or
  // closes a single User's ability to submit bet entries for the CURRENT
  // session, without touching the global session status for everyone else.
  const handleToggleEntry = async (id: string) => {
    const { error } = await toggleUserDataEntry(id);
    if (error) toast.error(error);
  };

  const handleDelete = async (id: string) => {
    const { error } = await deactivateAccount(id, tab);
    setConfirmDelete(null);
    if (error) { toast.error(error); return; }
    toast.success('Account deactivated');
  };

  const partnerShareSum = partners.filter(p => p.isActive).reduce((s, p) => s + p.sharePercentage, 0);
  const partnerShareOk = Math.abs(partnerShareSum - 100) < 0.01;

  const items: (UserAccount | PartnerAccount | AdminAccount)[] =
    tab === 'users' ? users : tab === 'partners' ? partners : admins;

  const tabs: Tab[] = isMasterAdmin ? ['users', 'partners', 'admins'] : ['users', 'partners'];

  return (
    <div className="space-y-5">
      {isMasterAdmin && (
        <div className="rounded-xl px-4 py-3 flex items-center gap-2" style={{ background: C.goldDim, border: `1px solid ${C.border}` }}>
          <Shield size={14} color={C.gold} />
          <p style={{ color: C.gold, fontSize: 12, fontWeight: 600 }}>
            Master Admin superuser — you can create and manage Admin, User, and Partner accounts across the whole platform.
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: C.card }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="px-5 py-2 rounded-lg transition-all capitalize"
            style={{
              background: tab === t ? C.goldDim : 'transparent',
              color: tab === t ? C.gold : C.textMuted,
              border: tab === t ? `1px solid ${C.border}` : '1px solid transparent',
              fontSize: 13, fontWeight: tab === t ? 600 : 400, cursor: 'pointer',
            }}>
            {t} ({t === 'users' ? users.length : t === 'partners' ? partners.length : admins.length})
          </button>
        ))}
      </div>

      {/* Partner share warning */}
      {tab === 'partners' && !partnerShareOk && (
        <div className="rounded-xl px-4 py-3" style={{ background: C.orangeBg, border: `1px solid ${C.orange}44` }}>
          <p style={{ color: C.orangeText, fontSize: 13 }}>
            Active partner shares sum to <strong>{partnerShareSum}%</strong> — must equal 100% for percentage-based distribution.
          </p>
        </div>
      )}
      {tab === 'partners' && partnerShareOk && partners.length > 0 && (
        <div className="rounded-xl px-4 py-3" style={{ background: C.greenBg, border: `1px solid ${C.green}44` }}>
          <p style={{ color: C.greenText, fontSize: 13 }}>Partner shares sum to 100% ✓ — ready for distribution.</p>
        </div>
      )}

      {/* Table card */}
      <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${C.border}` }}>
          <p style={{ color: C.textMuted, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em' }}>
            {tab.toUpperCase()} ({items.length})
          </p>
          <button onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 rounded-lg transition-all"
            style={{ background: C.goldGrad, color: '#000', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
            <Plus size={14} /> Add {TAB_LABEL[tab]}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.card2 }}>
                {['Username', 'Commission', 'Payout Rate', ...(tab === 'partners' ? ['Share %'] : []), ...(tab === 'users' ? ['Entry'] : []), 'Status', 'Actions']
                  .map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em' }}>
                      {h.toUpperCase()}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const p = item as PartnerAccount;
                const u = item as UserAccount;
                return (
                  <tr key={item.id} style={{ borderTop: `1px solid ${C.borderSubtle}` }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.card2; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{item.username}</span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ color: C.textSub, fontSize: 13 }}>{item.commissionRate}%</span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ color: C.textSub, fontSize: 13 }}>{item.payoutRate}×</span>
                    </td>
                    {tab === 'partners' && (
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          fontSize: 12, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                          background: C.blueBg, color: C.blueText,
                        }}>{p.sharePercentage}%</span>
                      </td>
                    )}
                    {tab === 'users' && (
                      <td style={{ padding: '12px 16px' }}>
                        <button onClick={() => handleToggleEntry(item.id)}
                          className="flex items-center gap-1.5"
                          style={{
                            fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                            background: u.dataEntryOpen ? C.greenBg : C.redBg,
                            color: u.dataEntryOpen ? C.greenText : C.redText,
                          }}
                          title={u.dataEntryOpen ? 'Close this user\'s entry for the current session' : 'Re-open this user\'s entry'}>
                          {u.dataEntryOpen ? <Unlock size={11} /> : <Lock size={11} />}
                          {u.dataEntryOpen ? 'Open' : 'Closed'}
                        </button>
                      </td>
                    )}
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
                        background: item.isActive ? C.greenBg : C.redBg,
                        color: item.isActive ? C.greenText : C.redText,
                      }}>{item.isActive ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div className="flex items-center gap-2">
                        <button onClick={() => openEdit(item)} style={btn(C.blueText, C.blueBg)} title="Edit">
                          <Pencil size={12} />
                        </button>
                        <button onClick={() => handleToggle(item.id)}
                          style={btn(item.isActive ? C.orangeText : C.greenText, item.isActive ? C.orangeBg : C.greenBg)}
                          title={item.isActive ? 'Deactivate' : 'Activate'}>
                          {item.isActive ? <UserX size={12} /> : <UserCheck size={12} />}
                        </button>
                        <button onClick={() => setConfirmDelete(item.id)} style={btn(C.redText, C.redBg)} title="Delete">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={tab === 'users' || tab === 'partners' ? 6 : 5} style={{ padding: '32px 16px', textAlign: 'center', color: C.textDim, fontSize: 13 }}>
                    No {tab} yet. Click "Add" to create one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <Modal title={editTarget ? `Edit ${TAB_LABEL[tab]}` : `Add ${TAB_LABEL[tab]}`}
          onClose={() => setShowModal(false)}>
          <div className="space-y-4">
            <Field label="USERNAME">
              <input style={inp} value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="e.g. alice" />
            </Field>
            {!editTarget && (
              <Field label="PASSWORD">
                <input type="password" style={inp} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Set password (min 8 characters)" />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="COMMISSION (%)">
                <input type="number" style={inp} value={form.commissionRate} onChange={e => setForm({ ...form, commissionRate: e.target.value })} min="0" max="100" step="0.5" />
              </Field>
              <Field label="PAYOUT RATE (×)">
                <input type="number" style={inp} value={form.payoutRate} onChange={e => setForm({ ...form, payoutRate: e.target.value })} min="1" />
              </Field>
            </div>
            {tab === 'partners' && (
              <Field label="DATA SHARE (%)">
                <input type="number" style={inp} value={form.sharePercentage} onChange={e => setForm({ ...form, sharePercentage: e.target.value })} min="0" max="100" step="1" />
              </Field>
            )}
            {tab === 'admins' && (
              <p style={{ color: C.textDim, fontSize: 11, lineHeight: 1.6 }}>
                This Admin will be able to create and manage their own Users and Partners, open/close sessions, and distribute over-limit data.
              </p>
            )}
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 rounded-lg"
                style={{ background: C.card2, color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 13 }}>
                Cancel
              </button>
              <button onClick={handleSave} className="flex-1 py-2.5 rounded-lg"
                style={{ background: C.goldGrad, color: '#000', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                {editTarget ? 'Save Changes' : 'Create Account'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <Modal title="Confirm Deletion" onClose={() => setConfirmDelete(null)}>
          <p style={{ color: C.textMuted, fontSize: 13, marginBottom: 20 }}>
            This will deactivate the account (soft delete) — it can no longer log in, but it stays in this list marked Inactive and its historical data is retained.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2.5 rounded-lg"
              style={{ background: C.card2, color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 13 }}>
              Cancel
            </button>
            <button onClick={() => handleDelete(confirmDelete!)} className="flex-1 py-2.5 rounded-lg"
              style={{ background: C.red, color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
              Delete Account
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
