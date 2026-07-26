import { useState } from 'react';
import { useApp } from '../context';
import { C } from '../theme';

export function LoginScreen() {
  const { login } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const doLogin = async () => {
    if (!username.trim() || !password) { setError('Enter both username and password'); return; }
    setSubmitting(true);
    setError('');
    const { error: loginError } = await login(username.trim(), password);
    setSubmitting(false);
    if (loginError) setError('Invalid username or password');
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden"
      style={{ background: C.bg }}>
      {/* Background grid */}
      <svg className="absolute inset-0 w-full h-full opacity-30" style={{ pointerEvents: 'none' }}>
        <pattern id="lgrid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
          <circle cx="0.5" cy="0.5" r="0.5" fill={C.gold} />
        </pattern>
        <rect width="100%" height="100%" fill="url(#lgrid)" />
      </svg>

      {/* Glow orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-5 blur-3xl"
        style={{ background: C.gold }} />
      <div className="absolute bottom-1/4 right-1/4 w-64 h-64 rounded-full opacity-5 blur-3xl"
        style={{ background: C.blue }} />

      <div className="relative z-10 w-full max-w-md mx-auto px-4">
        {/* Logo — the gem mark + "TREASURE" wordmark are both baked into
            this one asset (see public/brand/), so no separate <h1> text is
            needed alongside it. The "-transparent" variant drops the
            logo's own square backdrop fill so it blends into this screen's
            existing dark background/glow instead of showing as a
            mismatched hard-edged box. */}
        <div className="flex flex-col items-center mb-8">
          <img src="/brand/treasure-logo-transparent.svg" alt="Treasure" className="w-40 h-40" style={{ marginBottom: 4 }} />
          <p style={{ color: C.textDim, fontSize: 12, marginTop: 4, letterSpacing: '0.08em' }}>
            2D LOTTERY MANAGEMENT PLATFORM
          </p>
        </div>

        {/* Login card */}
        <div className="rounded-2xl p-8"
          style={{ background: C.card, border: `1px solid ${C.border}`, boxShadow: `0 0 60px rgba(201,168,76,0.06)` }}>
          <div className="space-y-5">
            <div>
              <label style={{ display: 'block', color: C.textMuted, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', marginBottom: 6 }}>
                USERNAME
              </label>
              <input
                className="w-full px-4 py-3 rounded-lg outline-none transition-all"
                style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.text, fontSize: 14 }}
                placeholder="Enter username (Master Admin: use email)"
                value={username}
                onChange={e => { setUsername(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && doLogin()}
                onFocus={e => { e.currentTarget.style.borderColor = C.borderBright; }}
                onBlur={e => { e.currentTarget.style.borderColor = C.border; }}
                autoComplete="username"
                disabled={submitting}
              />
            </div>
            <div>
              <label style={{ display: 'block', color: C.textMuted, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', marginBottom: 6 }}>
                PASSWORD
              </label>
              <input
                type="password"
                className="w-full px-4 py-3 rounded-lg outline-none transition-all"
                style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.text, fontSize: 14 }}
                placeholder="Enter password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && doLogin()}
                onFocus={e => { e.currentTarget.style.borderColor = C.borderBright; }}
                onBlur={e => { e.currentTarget.style.borderColor = C.border; }}
                autoComplete="current-password"
                disabled={submitting}
              />
            </div>
            {error && (
              <p style={{ color: C.redText, fontSize: 13, background: C.redBg, padding: '8px 12px', borderRadius: 8 }}>
                {error}
              </p>
            )}
            <button
              className="w-full py-3 rounded-lg transition-all"
              style={{
                background: C.goldGrad, color: '#000', fontSize: 14, fontWeight: 700, letterSpacing: '0.05em',
                cursor: submitting ? 'not-allowed' : 'pointer', border: 'none', opacity: submitting ? 0.7 : 1,
              }}
              onMouseEnter={e => { if (!submitting) (e.currentTarget as HTMLButtonElement).style.background = C.goldGradHov; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = C.goldGrad; }}
              onClick={doLogin}
              disabled={submitting}
            >
              {submitting ? 'SIGNING IN…' : 'SIGN IN'}
            </button>
          </div>
        </div>

        <p style={{ color: C.textDim, fontSize: 11, marginTop: 16, textAlign: 'center', lineHeight: 1.6 }}>
          Admin, User, and Partner accounts sign in with their username. Master Admin signs in with their verified email.
        </p>
      </div>
    </div>
  );
}
