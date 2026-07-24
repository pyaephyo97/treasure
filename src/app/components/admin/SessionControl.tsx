import { useEffect, useState } from 'react';
import { PlayCircle, StopCircle, Send, X, Bell, BellOff, Timer, TimerOff, PauseCircle, PlayCircle as ResumeCircle, Trash2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '../../context';
import { C } from '../../theme';
import { useCountdownMs, formatCountdown } from '../../utils/countdown';
import type { DeleteHistoryResult } from '../../types';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between mb-4">
          <h2 style={{ color: C.text, fontSize: 16, fontWeight: 700 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SessionControl() {
  const {
    session, openSession, closeSession, setAutoCloseTimer, clearAutoCloseTimer, setEntryHold, clearEntryHold,
    warnings, sendWarning, retractWarning, role, allSessions, previewDeleteHistory, confirmDeleteHistory,
  } = useApp();
  const [showOpenConfirm, setShowOpenConfirm] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [warnMsg, setWarnMsg] = useState('');
  const [warnTarget, setWarnTarget] = useState<'all' | 'users' | 'partners'>('all');
  const [minutesInput, setMinutesInput] = useState('15');
  const [settingTimer, setSettingTimer] = useState(false);
  const [holdMinutesInput, setHoldMinutesInput] = useState('5');
  const [settingHold, setSettingHold] = useState(false);
  const [deleteSessionId, setDeleteSessionId] = useState('');
  const [deletePreview, setDeletePreview] = useState<DeleteHistoryResult | null>(null);
  const [previewingDelete, setPreviewingDelete] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleOpenSession = async () => {
    const { error } = await openSession();
    if (error) { toast.error(error); return; }
    toast.success('Session opened');
    setShowOpenConfirm(false);
  };

  const handleCloseSession = async () => {
    const { error } = await closeSession();
    if (error) { toast.error(error); return; }
    toast.success('Session closed');
    setShowCloseConfirm(false);
  };

  const handleStartTimer = async () => {
    const minutes = parseInt(minutesInput, 10);
    if (isNaN(minutes) || minutes <= 0) { toast.error('Enter a number of minutes greater than 0'); return; }
    setSettingTimer(true);
    const { error } = await setAutoCloseTimer(minutes);
    setSettingTimer(false);
    if (error) { toast.error(error); return; }
    toast.success(`Session will auto-close in ${minutes} minute${minutes !== 1 ? 's' : ''}`);
  };

  const handleCancelTimer = async () => {
    const { error } = await clearAutoCloseTimer();
    if (error) { toast.error(error); return; }
    toast.success('Auto-close timer cancelled');
  };

  const remainingMs = useCountdownMs(session.status === 'open' ? session.autoCloseAt : null);
  const timerExpired = remainingMs !== null && remainingMs <= 0;

  const handleStartHold = async () => {
    const minutes = parseInt(holdMinutesInput, 10);
    if (isNaN(minutes) || minutes <= 0) { toast.error('Enter a number of minutes greater than 0'); return; }
    setSettingHold(true);
    const { error } = await setEntryHold(minutes);
    setSettingHold(false);
    if (error) { toast.error(error); return; }
    toast.success(`Entry held for ${minutes} minute${minutes !== 1 ? 's' : ''}`);
  };

  const handleReleaseHold = async () => {
    const { error } = await clearEntryHold();
    if (error) { toast.error(error); return; }
    toast.success('Hold released — entry resumed');
  };

  const holdRemainingMs = useCountdownMs(session.status === 'open' ? session.entryHoldUntil : null);
  const holdActive = holdRemainingMs !== null && holdRemainingMs > 0;

  const handleSendWarning = async () => {
    if (!warnMsg.trim()) { toast.error('Message cannot be empty'); return; }
    const { error } = await sendWarning(warnMsg.trim(), warnTarget);
    if (error) { toast.error(error); return; }
    toast.success('Warning sent');
    setWarnMsg('');
  };

  const handleDeleteWarning = async (id: string) => {
    const { error } = await retractWarning(id);
    if (error) { toast.error(error); return; }
    toast.success('Warning removed');
  };

  // Loads a fresh preview (counts only, nothing deleted) whenever a
  // different session is picked in the Delete History dropdown — mirrors
  // the same dry-run-then-confirm pattern Total Data's Share modal already
  // uses for distribute_over_limit.
  useEffect(() => {
    if (!deleteSessionId) { setDeletePreview(null); return; }
    let cancelled = false;
    setPreviewingDelete(true);
    previewDeleteHistory(deleteSessionId).then(({ result, error }) => {
      if (cancelled) return;
      setPreviewingDelete(false);
      if (error) { toast.error(error); setDeletePreview(null); return; }
      setDeletePreview(result ?? null);
    });
    return () => { cancelled = true; };
  }, [deleteSessionId, previewDeleteHistory]);

  const deleteTargetSession = allSessions.find(s => s.id === deleteSessionId);
  // Deleting is only truly a no-op when there's nothing in scope AND the
  // session record itself wouldn't be removed either (i.e. other admins'
  // data elsewhere is what's keeping it non-empty) — if there's no data but
  // the session WOULD be removed, that's still a meaningful action (cleans
  // up an empty/accidentally-opened session by name).
  const isNoOp = !!deletePreview
    && deletePreview.betEntriesCount === 0
    && deletePreview.shareHistoryCount === 0
    && !deletePreview.willRemoveSession;

  const handleConfirmDelete = async () => {
    if (!deleteSessionId) return;
    setDeleting(true);
    const { result, error } = await confirmDeleteHistory(deleteSessionId);
    setDeleting(false);
    if (error) { toast.error(error); return; }
    const dataMsg = `Deleted ${result?.betEntriesCount ?? 0} bet entries and ${result?.shareHistoryCount ?? 0} share action(s)`;
    toast.success(result?.sessionDeleted ? `${dataMsg} — session removed` : dataMsg);
    setShowDeleteConfirm(false);
    setDeleteSessionId('');
    setDeletePreview(null);
  };

  const fmt = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

  const inp = { width: '100%', padding: '10px 12px', borderRadius: 8, outline: 'none', background: C.card2, border: `1px solid ${C.border}`, color: C.text, fontSize: 13 };

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Session Status Card */}
      <div className="rounded-2xl p-6" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 16 }}>SESSION STATUS</p>

        <div className="flex items-start gap-4 mb-6">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-3 h-3 rounded-full" style={{ background: session.status === 'open' ? C.green : C.red }} />
              <span style={{ fontSize: 22, fontWeight: 800, color: session.status === 'open' ? C.greenText : C.redText }}>
                {session.status.toUpperCase()}
              </span>
            </div>
            <p style={{ color: C.textMuted, fontSize: 13 }}>Session: {session.label}</p>
            <p style={{ color: C.textMuted, fontSize: 13 }}>Opened: {fmt(session.openedAt)}</p>
            {session.closedAt && (
              <p style={{ color: C.textMuted, fontSize: 13 }}>Closed: {fmt(session.closedAt)}</p>
            )}
            {session.winningNumber && (
              <p style={{ color: C.gold, fontSize: 13, fontWeight: 600 }}>
                Winning Number: #{session.winningNumber}
              </p>
            )}
          </div>
          {session.status === 'open' && remainingMs !== null && (
            <div className="flex flex-col items-center px-4 py-2 rounded-xl flex-shrink-0"
              style={{ background: timerExpired ? C.redBg : C.orangeBg, border: `1px solid ${(timerExpired ? C.red : C.orange)}44` }}>
              <span style={{ color: timerExpired ? C.redText : C.orangeText, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>
                {timerExpired ? 'CLOSING…' : 'AUTO-CLOSE IN'}
              </span>
              <span style={{ color: timerExpired ? C.redText : C.orangeText, fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                {formatCountdown(remainingMs)}
              </span>
            </div>
          )}
          {holdActive && (
            <div className="flex flex-col items-center px-4 py-2 rounded-xl flex-shrink-0"
              style={{ background: C.blueBg, border: `1px solid ${C.blue}44` }}>
              <span style={{ color: C.blueText, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>
                ON HOLD
              </span>
              <span style={{ color: C.blueText, fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                {formatCountdown(holdRemainingMs ?? 0)}
              </span>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            disabled={session.status === 'open'}
            onClick={() => setShowOpenConfirm(true)}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl transition-all"
            style={{
              background: session.status === 'open' ? C.card2 : C.greenBg,
              color: session.status === 'open' ? C.textDim : C.greenText,
              border: `1px solid ${session.status === 'open' ? C.borderSubtle : C.green + '44'}`,
              cursor: session.status === 'open' ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 600,
            }}>
            <PlayCircle size={16} />
            Open Session
          </button>
          <button
            disabled={session.status === 'closed'}
            onClick={() => setShowCloseConfirm(true)}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl transition-all"
            style={{
              background: session.status === 'closed' ? C.card2 : C.redBg,
              color: session.status === 'closed' ? C.textDim : C.redText,
              border: `1px solid ${session.status === 'closed' ? C.borderSubtle : C.red + '44'}`,
              cursor: session.status === 'closed' ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 600,
            }}>
            <StopCircle size={16} />
            Close Session
          </button>
        </div>
      </div>

      {/* Auto-Close Timer */}
      <div className="rounded-2xl p-6" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 4 }}>AUTO-CLOSE TIMER</p>
        <p style={{ color: C.textMuted, fontSize: 12, marginBottom: 16 }}>
          Set a countdown to close this session automatically. Users and partners see the same countdown so they know how much time is left.
        </p>

        {session.status !== 'open' ? (
          <p style={{ color: C.textDim, fontSize: 12 }}>Open a session to set an auto-close timer.</p>
        ) : session.autoCloseAt ? (
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Timer size={16} color={timerExpired ? C.red : C.orange} />
              <span style={{ color: timerExpired ? C.redText : C.orangeText, fontSize: 13, fontWeight: 600 }}>
                {timerExpired ? 'Closing session…' : `Closes at ${new Date(session.autoCloseAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — ${formatCountdown(remainingMs ?? 0)} left`}
              </span>
            </div>
            <button onClick={handleCancelTimer}
              className="flex items-center gap-2 px-4 py-2 rounded-lg"
              style={{ background: C.card2, color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              <TimerOff size={13} /> Cancel Timer
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="number"
              min={1}
              value={minutesInput}
              onChange={e => setMinutesInput(e.target.value)}
              style={{ width: 90, padding: '8px 12px', borderRadius: 8, outline: 'none', background: C.card2, border: `1px solid ${C.border}`, color: C.text, fontSize: 13 }}
            />
            <span style={{ color: C.textMuted, fontSize: 13 }}>minutes</span>
            <button onClick={handleStartTimer} disabled={settingTimer}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl"
              style={{
                background: C.goldGrad, color: '#000', border: 'none',
                cursor: settingTimer ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700,
              }}>
              <Timer size={14} /> {settingTimer ? 'Starting…' : 'Start Countdown'}
            </button>
          </div>
        )}
      </div>

      {/* Hold Session */}
      <div className="rounded-2xl p-6" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 4 }}>HOLD SESSION</p>
        <p style={{ color: C.textMuted, fontSize: 12, marginBottom: 16 }}>
          Temporarily freezes bet-entry submissions for all users for a set number of minutes — the session stays open, entry just pauses and resumes automatically. Users and partners see the same countdown.
        </p>

        {session.status !== 'open' ? (
          <p style={{ color: C.textDim, fontSize: 12 }}>Open a session to hold entry.</p>
        ) : holdActive ? (
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <PauseCircle size={16} color={C.blue} />
              <span style={{ color: C.blueText, fontSize: 13, fontWeight: 600 }}>
                Entry held — resumes in {formatCountdown(holdRemainingMs ?? 0)}
              </span>
            </div>
            <button onClick={handleReleaseHold}
              className="flex items-center gap-2 px-4 py-2 rounded-lg"
              style={{ background: C.card2, color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              <ResumeCircle size={13} /> Release Now
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="number"
              min={1}
              value={holdMinutesInput}
              onChange={e => setHoldMinutesInput(e.target.value)}
              style={{ width: 90, padding: '8px 12px', borderRadius: 8, outline: 'none', background: C.card2, border: `1px solid ${C.border}`, color: C.text, fontSize: 13 }}
            />
            <span style={{ color: C.textMuted, fontSize: 13 }}>minutes</span>
            <button onClick={handleStartHold} disabled={settingHold}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl"
              style={{
                background: C.blueBg, color: C.blueText, border: `1px solid ${C.blue}44`,
                cursor: settingHold ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700,
              }}>
              <PauseCircle size={14} /> {settingHold ? 'Holding…' : 'Hold Session'}
            </button>
          </div>
        )}
      </div>

      {/* Warning Messages */}
      <div className="rounded-2xl p-6" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 16 }}>SEND WARNING MESSAGE</p>

        <div className="space-y-3 mb-4">
          <textarea
            rows={3}
            value={warnMsg}
            onChange={e => setWarnMsg(e.target.value)}
            placeholder="Type a warning message for users and/or partners..."
            style={{ ...inp, resize: 'vertical' }}
          />
          <div className="flex gap-2 flex-wrap">
            {(['all', 'users', 'partners'] as const).map(t => (
              <button key={t} onClick={() => setWarnTarget(t)}
                className="px-4 py-2 rounded-lg capitalize transition-all"
                style={{
                  background: warnTarget === t ? C.orangeBg : C.card2,
                  color: warnTarget === t ? C.orangeText : C.textMuted,
                  border: `1px solid ${warnTarget === t ? C.orange + '44' : C.borderSubtle}`,
                  fontSize: 12, fontWeight: warnTarget === t ? 600 : 400, cursor: 'pointer',
                }}>
                {t === 'all' ? 'All (Users + Partners)' : `All ${t.charAt(0).toUpperCase() + t.slice(1)}`}
              </button>
            ))}
          </div>
          <button onClick={handleSendWarning}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl"
            style={{ background: C.orangeBg, color: C.orangeText, border: `1px solid ${C.orange}44`, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            <Send size={14} /> Send Warning
          </button>
        </div>

        {/* Sent warnings */}
        {warnings.length > 0 ? (
          <div className="space-y-2">
            <p style={{ color: C.textDim, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 8 }}>
              ACTIVE WARNINGS ({warnings.length})
            </p>
            {warnings.map(w => (
              <div key={w.id} className="flex items-start gap-3 p-3 rounded-xl"
                style={{ background: C.orangeBg, border: `1px solid ${C.orange}33` }}>
                <Bell size={14} color={C.orange} className="flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p style={{ color: C.text, fontSize: 13, lineHeight: 1.4 }}>{w.message}</p>
                  <p style={{ color: C.textDim, fontSize: 11, marginTop: 3 }}>
                    → {w.targetRole === 'all' ? 'All users & partners' : `All ${w.targetRole}`} · {fmt(w.createdAt)}
                  </p>
                </div>
                <button onClick={() => handleDeleteWarning(w.id)}
                  style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', padding: 2 }}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 py-3" style={{ color: C.textDim }}>
            <BellOff size={14} />
            <span style={{ fontSize: 12 }}>No active warnings</span>
          </div>
        )}
      </div>

      {/* Delete History */}
      <div className="rounded-2xl p-6" style={{ background: C.card, border: `1px solid ${C.red}33` }}>
        <p style={{ color: C.redText, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', marginBottom: 4 }}>DELETE HISTORY</p>
        <p style={{ color: C.textMuted, fontSize: 12, marginBottom: 16 }}>
          Pick a session by name to permanently clear its data — user-submitted bet entries and any confirmed
          Share-to-Partners records (Total Data) — and remove the session itself from the list. This cannot be
          undone.
          {role === 'admin' && ' As a regular Admin, this only clears your own managed users’ entries and your own share actions. If another admin still has data in this session, it stays clearable but the session record itself can’t be removed until theirs is cleared too.'}
        </p>

        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={deleteSessionId}
            onChange={e => setDeleteSessionId(e.target.value)}
            style={{ ...inp, flex: 1, minWidth: 200 }}>
            <option value="">Select a session…</option>
            {allSessions.map(s => (
              <option key={s.id} value={s.id}>{s.label} — {s.status}{s.winningNumber ? ` — #${s.winningNumber}` : ''}</option>
            ))}
          </select>
        </div>

        {deleteSessionId && (
          <div className="mt-3 p-3 rounded-xl" style={{ background: C.card2, border: `1px solid ${C.border}` }}>
            {previewingDelete ? (
              <p style={{ color: C.textDim, fontSize: 12 }}>Checking what would be deleted…</p>
            ) : deletePreview ? (
              isNoOp ? (
                <p style={{ color: C.textDim, fontSize: 12 }}>
                  Nothing to delete — no data in scope for your account, and other admins’ data elsewhere is keeping this session record in place.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {(deletePreview.betEntriesCount > 0 || deletePreview.shareHistoryCount > 0) && (
                    <p style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.6 }}>
                      Will permanently delete <span style={{ color: C.text, fontWeight: 700 }}>{deletePreview.betEntriesCount.toLocaleString()}</span> bet
                      {' '}{deletePreview.betEntriesCount === 1 ? 'entry' : 'entries'} and{' '}
                      <span style={{ color: C.text, fontWeight: 700 }}>{deletePreview.shareHistoryCount.toLocaleString()}</span> share
                      {' '}action{deletePreview.shareHistoryCount === 1 ? '' : 's'}
                      {deletePreview.shareHistoryCount > 0 && ` (${deletePreview.totalSharedAmount.toLocaleString()} total shared)`}.
                    </p>
                  )}
                  <p style={{ color: deletePreview.willRemoveSession ? C.redText : C.textDim, fontSize: 12, fontWeight: deletePreview.willRemoveSession ? 600 : 400 }}>
                    {deletePreview.willRemoveSession
                      ? 'The session record itself will also be removed.'
                      : 'Other admins’ data still exists for this session, so the session record will stay (with your data cleared out of it).'}
                  </p>
                </div>
              )
            ) : null}
          </div>
        )}

        <button
          onClick={() => setShowDeleteConfirm(true)}
          disabled={!deleteSessionId || previewingDelete || isNoOp}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl mt-3"
          style={{
            background: (!deleteSessionId || previewingDelete || isNoOp) ? C.card2 : C.redBg,
            color: (!deleteSessionId || previewingDelete || isNoOp) ? C.textDim : C.redText,
            border: `1px solid ${(!deleteSessionId || previewingDelete || isNoOp) ? C.borderSubtle : C.red + '44'}`,
            cursor: (!deleteSessionId || previewingDelete || isNoOp) ? 'not-allowed' : 'pointer',
            fontSize: 13, fontWeight: 700,
          }}>
          <Trash2 size={14} /> Delete History
        </button>
      </div>

      {/* Open confirm */}
      {showOpenConfirm && (
        <Modal title="Open New Session?" onClose={() => setShowOpenConfirm(false)}>
          <p style={{ color: C.textMuted, fontSize: 13, marginBottom: 20 }}>
            This will start a new session and allow users to begin submitting bet entries.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setShowOpenConfirm(false)} className="flex-1 py-2.5 rounded-lg"
              style={{ background: C.card2, color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 13 }}>
              Cancel
            </button>
            <button onClick={handleOpenSession} className="flex-1 py-2.5 rounded-lg"
              style={{ background: C.green, color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
              Open Session
            </button>
          </div>
        </Modal>
      )}

      {/* Close confirm */}
      {showCloseConfirm && (
        <Modal title="Close Session?" onClose={() => setShowCloseConfirm(false)}>
          <p style={{ color: C.textMuted, fontSize: 13, marginBottom: 20 }}>
            Closing the session will disable all data entry for users. This action requires confirmation.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setShowCloseConfirm(false)} className="flex-1 py-2.5 rounded-lg"
              style={{ background: C.card2, color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 13 }}>
              Cancel
            </button>
            <button onClick={handleCloseSession} className="flex-1 py-2.5 rounded-lg"
              style={{ background: C.red, color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
              Close Session
            </button>
          </div>
        </Modal>
      )}

      {/* Delete History confirm */}
      {showDeleteConfirm && deletePreview && (
        <Modal title="Delete Session History?" onClose={() => setShowDeleteConfirm(false)}>
          <div className="flex items-start gap-3 p-3 rounded-xl mb-4" style={{ background: C.redBg }}>
            <AlertTriangle size={16} color={C.red} className="flex-shrink-0 mt-0.5" />
            <p style={{ color: C.redText, fontSize: 12, lineHeight: 1.6 }}>
              This permanently deletes data for <strong>{deleteTargetSession?.label ?? 'this session'}</strong> — it
              cannot be undone.
              {deletePreview.willRemoveSession
                ? ' The session record itself will be removed too.'
                : ' Other admins’ data still exists for this session, so the session record will stay behind (with your data cleared out of it).'}
            </p>
          </div>
          <p style={{ color: C.textMuted, fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
            <span style={{ color: C.text, fontWeight: 700 }}>{deletePreview.betEntriesCount.toLocaleString()}</span> bet
            {' '}{deletePreview.betEntriesCount === 1 ? 'entry' : 'entries'} and{' '}
            <span style={{ color: C.text, fontWeight: 700 }}>{deletePreview.shareHistoryCount.toLocaleString()}</span> share
            {' '}action{deletePreview.shareHistoryCount === 1 ? '' : 's'} will be deleted.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setShowDeleteConfirm(false)} disabled={deleting} className="flex-1 py-2.5 rounded-lg"
              style={{ background: C.card2, color: C.textMuted, border: `1px solid ${C.border}`, cursor: deleting ? 'not-allowed' : 'pointer', fontSize: 13 }}>
              Cancel
            </button>
            <button onClick={handleConfirmDelete} disabled={deleting} className="flex-1 py-2.5 rounded-lg"
              style={{ background: C.red, color: '#fff', border: 'none', cursor: deleting ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700 }}>
              {deleting ? 'Deleting…' : 'Delete Permanently'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
