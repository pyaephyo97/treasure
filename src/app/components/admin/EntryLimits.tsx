import { useState, useMemo, useEffect } from 'react';
import { Zap, Search, Hash, Pencil, Users, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '../../context';
import { C } from '../../theme';
import type { LimitRow } from '../../types';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between mb-4">
          <h2 style={{ color: C.text, fontSize: 16, fontWeight: 700 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer' }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EntryLimits() {
  const { limitTable, users, assignLimitTable } = useApp();

  // Draft table: Quick Set, Quick Select by Number, and individual row
  // edits below all only mutate this local copy — nothing reaches the
  // server until "Assign to All Users" / "Assign to Selected Users" is
  // pressed. Re-synced from the live `limitTable` whenever it changes
  // (initial load, switching sessions, or right after this page's own
  // Assign call refreshes it) so the draft always starts from what's
  // actually persisted.
  const [draftTable, setDraftTable] = useState<LimitRow[]>(limitTable);
  useEffect(() => { setDraftTable(limitTable); }, [limitTable]);

  const [defaultVal, setDefaultVal] = useState('5000');
  const [search, setSearch] = useState('');
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [digitInput, setDigitInput] = useState('');
  const [digitVal, setDigitVal] = useState('2000');
  const [exactNumInput, setExactNumInput] = useState('');
  const [exactVal, setExactVal] = useState('2000');
  const [assigningAll, setAssigningAll] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [assigningSelected, setAssigningSelected] = useState(false);

  const filtered = useMemo(() =>
    draftTable.filter(r => r.number.includes(search.trim())),
    [draftTable, search]
  );

  // Grouped view: 00-19 / 20-39 / 40-59 / 60-79 / 80-99, each its own column,
  // so the table reads left-to-right in blocks of 20 instead of one long
  // vertical scroll.
  const COLUMN_SIZE = 20;
  const columns = useMemo(() => {
    const buckets: typeof filtered[] = [[], [], [], [], []];
    filtered.forEach(row => {
      const n = parseInt(row.number, 10);
      const idx = Math.min(buckets.length - 1, Math.floor(n / COLUMN_SIZE));
      buckets[idx].push(row);
    });
    return buckets;
  }, [filtered]);

  // --- Quick Set / Quick Select / row edit — local draft only, no server call ---

  const setDefault = () => {
    const val = parseInt(defaultVal);
    if (isNaN(val) || val < 0) { toast.error('Enter a valid limit value'); return; }
    setDraftTable(prev => prev.map(r => ({ ...r, limit: val })));
    toast.success(`Table set to ${val.toLocaleString()} for all numbers — press Assign to save`);
  };

  const applyDigit = () => {
    if (!/^\d$/.test(digitInput)) { toast.error('Enter a single digit, 0–9'); return; }
    const val = parseInt(digitVal);
    if (isNaN(val) || val < 0) { toast.error('Enter a valid limit value'); return; }
    let count = 0;
    setDraftTable(prev => prev.map(r => {
      if (r.number[0] === digitInput || r.number[1] === digitInput) { count++; return { ...r, limit: val }; }
      return r;
    }));
    toast.success(`Set ${count} numbers containing "${digitInput}" to ${val.toLocaleString()} in table — press Assign to save`);
  };

  const applyExact = () => {
    if (!/^\d{1,2}$/.test(exactNumInput)) { toast.error('Enter a valid number, 00–99'); return; }
    const num = exactNumInput.padStart(2, '0');
    if (parseInt(num, 10) > 99) { toast.error('Enter a valid number, 00–99'); return; }
    const val = parseInt(exactVal);
    if (isNaN(val) || val < 0) { toast.error('Enter a valid limit value'); return; }
    setDraftTable(prev => prev.map(r => r.number === num ? { ...r, limit: val } : r));
    toast.success(`#${num} set to ${val.toLocaleString()} in table — press Assign to save`);
    setExactNumInput('');
  };

  const saveRow = (number: string) => {
    const val = parseInt(editVal);
    if (isNaN(val) || val < 0) { toast.error('Invalid limit value'); return; }
    setDraftTable(prev => prev.map(r => r.number === number ? { ...r, limit: val } : r));
    setEditingRow(null);
    toast.success(`#${number} set to ${val.toLocaleString()} in table — press Assign to save`);
  };

  // --- Assign — this is what actually persists the draft ---

  const assignToAll = async () => {
    if (users.length === 0) { toast.error('No users to assign to'); return; }
    setAssigningAll(true);
    const { error } = await assignLimitTable(draftTable.map(r => ({ number: r.number, limit: r.limit })));
    setAssigningAll(false);
    if (error) { toast.error(error); return; }
    toast.success(`Table assigned to all ${users.length} user${users.length !== 1 ? 's' : ''}`);
  };

  const toggleSelectedUser = (id: string) => {
    setSelectedUsers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const assignToSelected = async () => {
    if (selectedUsers.length === 0) { toast.error('Select at least one user'); return; }
    setAssigningSelected(true);
    const { error } = await assignLimitTable(draftTable.map(r => ({ number: r.number, limit: r.limit })), selectedUsers);
    setAssigningSelected(false);
    if (error) { toast.error(error); return; }
    toast.success(`Table assigned to ${selectedUsers.length} selected user${selectedUsers.length !== 1 ? 's' : ''}`);
    setShowAssignModal(false);
    setSelectedUsers([]);
  };

  // fontSize 16 is the iOS Safari auto-zoom threshold — anything smaller
  // makes the whole page zoom in when the field is focused on a phone.
  const inp = { padding: '8px 12px', borderRadius: 8, outline: 'none', background: C.card2, border: `1px solid ${C.border}`, color: C.text, fontSize: 16 };

  return (
    <div className="space-y-4 max-w-6xl">
      {/* Controls — kept at a comfortable reading width; the table below is wider still. */}
      <div className="max-w-2xl space-y-4">
      <div className="rounded-xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 14 }}>QUICK SET</p>
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 flex items-center gap-2" style={{ minWidth: 180 }}>
            <input
              type="text"
              inputMode="numeric"
              value={defaultVal}
              onChange={e => setDefaultVal(e.target.value.replace(/\D/g, ''))}
              placeholder="Default limit for all"
              style={{ ...inp, flex: 1, minWidth: 0 }}
            />
            <button onClick={setDefault}
              className="flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap"
              style={{ background: C.goldGrad, color: '#000', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
              <Zap size={14} /> Set All
            </button>
          </div>
        </div>
      </div>

      {/* Quick select by digit */}
      <div className="rounded-xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 4 }}>QUICK SELECT BY NUMBER</p>
        <p style={{ color: C.textMuted, fontSize: 12, marginBottom: 14 }}>
          Enter a digit and a value — every number containing that digit gets set to it. e.g. digit <strong>2</strong>, value <strong>2000</strong> → 02, 12, 20, 21, 22, 23…29, 32, 42…92 all become 2000.
        </p>
        <div className="flex gap-3 flex-wrap items-center">
          <input
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digitInput}
            onChange={e => setDigitInput(e.target.value.replace(/\D/g, '').slice(0, 1))}
            placeholder="2"
            style={{ ...inp, width: 64, textAlign: 'center', fontSize: 18, fontWeight: 700 }}
          />
          <span style={{ color: C.textDim, fontSize: 13 }}>→ value</span>
          <input
            type="text"
            inputMode="numeric"
            value={digitVal}
            onChange={e => setDigitVal(e.target.value.replace(/\D/g, ''))}
            placeholder="Limit value"
            style={{ ...inp, width: 140 }}
          />
          <button onClick={applyDigit}
            className="flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap"
            style={{ background: C.blueBg, color: C.blueText, border: `1px solid ${C.blue}44`, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
            <Hash size={14} /> {`Apply to all "${digitInput || '#'}"`}
          </button>
        </div>

        <div style={{ height: 1, background: C.borderSubtle, margin: '16px 0' }} />

        <p style={{ color: C.textMuted, fontSize: 12, marginBottom: 14 }}>
          Or set one exact number directly — e.g. index <strong>45</strong>, value <strong>10000</strong> → only #45 becomes 10000.
        </p>
        <div className="flex gap-3 flex-wrap items-center">
          <input
            type="text"
            inputMode="numeric"
            maxLength={2}
            value={exactNumInput}
            onChange={e => setExactNumInput(e.target.value.replace(/\D/g, '').slice(0, 2))}
            placeholder="45"
            style={{ ...inp, width: 64, textAlign: 'center', fontSize: 18, fontWeight: 700 }}
          />
          <span style={{ color: C.textDim, fontSize: 13 }}>→ value</span>
          <input
            type="text"
            inputMode="numeric"
            value={exactVal}
            onChange={e => setExactVal(e.target.value.replace(/\D/g, ''))}
            placeholder="Limit value"
            style={{ ...inp, width: 140 }}
          />
          <button onClick={applyExact}
            className="flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap"
            style={{ background: C.goldGrad, color: '#000', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
            <Hash size={14} /> {`Set #${exactNumInput.padStart(2, '0') || '##'}`}
          </button>
        </div>
      </div>
      </div>

      {/* Limit table (draft) */}
      <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex items-center gap-3 px-5 py-4 flex-wrap" style={{ borderBottom: `1px solid ${C.border}` }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em' }}>
              LIMIT TABLE (DRAFT) — {draftTable.length} NUMBERS
            </p>
            <p style={{ color: C.textMuted, fontSize: 11, marginTop: 2 }}>
              Quick Set, Quick Select, and row edits only change this table — nothing is saved until you Assign it.
            </p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: C.card2, border: `1px solid ${C.border}` }}>
            <Search size={12} color={C.textDim} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter number..."
              style={{ background: 'none', border: 'none', outline: 'none', color: C.text, fontSize: 16, width: 90 }}
            />
          </div>
          <button onClick={assignToAll} disabled={assigningAll}
            className="flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap"
            style={{
              background: C.goldGrad, color: '#000', border: 'none',
              cursor: assigningAll ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700,
            }}>
            <Users size={14} /> {assigningAll ? 'Assigning…' : 'Assign to All Users'}
          </button>
          <button onClick={() => setShowAssignModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap"
            style={{ background: C.blueBg, color: C.blueText, border: `1px solid ${C.blue}44`, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
            <Send size={14} /> Assign to Selected Users
          </button>
        </div>

        <div
          className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4"
          style={{ maxHeight: 640, overflowY: 'auto' }}>
          {columns.map((col, ci) => {
            const rangeStart = ci * COLUMN_SIZE;
            const rangeEnd = Math.min(99, rangeStart + COLUMN_SIZE - 1);
            const label = `${String(rangeStart).padStart(2, '0')}–${String(rangeEnd).padStart(2, '0')}`;
            return (
              <div key={ci} className="rounded-lg overflow-hidden" style={{ background: C.card2, border: `1px solid ${C.borderSubtle}` }}>
                <div className="px-4 py-2.5" style={{ borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ color: C.textDim, fontSize: 12, fontWeight: 700, letterSpacing: '0.05em' }}>{label}</span>
                </div>
                {col.length === 0 ? (
                  <p style={{ color: C.textDim, fontSize: 12, padding: '14px' }}>No matches</p>
                ) : col.map(row => (
                  <div key={row.number} className="flex items-center gap-3 px-4 py-3"
                    style={{ borderTop: `1px solid ${C.borderSubtle}` }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.card; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                    <span className="w-12 h-8 rounded flex items-center justify-center flex-shrink-0"
                      style={{ background: C.goldDim, color: C.gold, fontSize: 15, fontWeight: 700 }}>
                      {row.number}
                    </span>
                    {editingRow === row.number ? (
                      <div className="flex items-center gap-2 flex-1 justify-end">
                        <input
                          type="text"
                          inputMode="numeric"
                          autoFocus
                          value={editVal}
                          onChange={e => setEditVal(e.target.value.replace(/\D/g, ''))}
                          onKeyDown={e => { if (e.key === 'Enter') saveRow(row.number); if (e.key === 'Escape') setEditingRow(null); }}
                          style={{ ...inp, width: 88, padding: '6px 8px', fontSize: 16 }}
                        />
                        <button onClick={() => saveRow(row.number)}
                          className="flex items-center justify-center"
                          style={{ background: C.goldGrad, color: '#000', border: 'none', cursor: 'pointer', padding: '7px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
                          Save
                        </button>
                        <button onClick={() => setEditingRow(null)}
                          className="flex items-center justify-center"
                          style={{ background: C.card3, color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer', padding: '7px 10px', borderRadius: 6, fontSize: 12 }}>
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 flex-1 justify-between min-w-0">
                        <span style={{ color: C.text, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}>{row.limit.toLocaleString()}</span>
                        <button onClick={() => { setEditingRow(row.number); setEditVal(String(row.limit)); }}
                          className="flex items-center gap-1.5 flex-shrink-0"
                          style={{
                            background: C.card3, color: C.textMuted, border: `1px solid ${C.border}`,
                            cursor: 'pointer', padding: '7px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                          }}>
                          <Pencil size={12} /> Edit
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Assign to selected users modal */}
      {showAssignModal && (
        <Modal title="Assign to Selected Users" onClose={() => setShowAssignModal(false)}>
          <p style={{ color: C.textMuted, fontSize: 13, marginBottom: 14 }}>
            Select which users get this table. Only the checked users below will be updated.
          </p>
          <div className="space-y-2 mb-4" style={{ maxHeight: 240, overflowY: 'auto' }}>
            {users.length === 0 ? (
              <p style={{ color: C.textDim, fontSize: 13 }}>No users to assign to.</p>
            ) : users.map(u => (
              <label key={u.id} className="flex items-center gap-3 p-2 rounded-lg cursor-pointer"
                style={{ background: selectedUsers.includes(u.id) ? C.goldDim : C.card2 }}>
                <input type="checkbox" checked={selectedUsers.includes(u.id)} onChange={() => toggleSelectedUser(u.id)}
                  style={{ accentColor: C.gold }} />
                <span style={{ color: C.text, fontSize: 13 }}>{u.username}</span>
              </label>
            ))}
          </div>
          <p style={{ color: C.textDim, fontSize: 11, marginBottom: 14 }}>
            {selectedUsers.length === 0 ? 'No users selected yet' : `Will assign to ${selectedUsers.length} selected user(s)`}
          </p>
          <div className="flex gap-3">
            <button onClick={() => setShowAssignModal(false)} className="flex-1 py-2.5 rounded-lg"
              style={{ background: C.card2, color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 13 }}>
              Cancel
            </button>
            <button onClick={assignToSelected} disabled={assigningSelected || selectedUsers.length === 0} className="flex-1 py-2.5 rounded-lg"
              style={{
                background: C.goldGrad, color: '#000', border: 'none',
                cursor: (assigningSelected || selectedUsers.length === 0) ? 'not-allowed' : 'pointer',
                fontSize: 13, fontWeight: 700, opacity: selectedUsers.length === 0 ? 0.5 : 1,
              }}>
              {assigningSelected ? 'Assigning…' : 'Assign'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
