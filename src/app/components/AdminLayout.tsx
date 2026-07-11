import { useState, lazy, Suspense } from 'react';
import {
  LayoutDashboard, Users, Handshake, CalendarClock,
  ListOrdered, BarChart3, Trophy, FileText, LogOut, Menu, X, Shield, UserCircle,
} from 'lucide-react';
import { useApp } from '../context';
import { C } from '../theme';

// Each of these only mounts when its own nav item is selected (see the
// page === '<id>' switch below), so they're natural code-split points —
// an Admin who only ever opens Dashboard + Session Control never pays the
// download cost for e.g. TotalData's or AccountManagement's bundle weight.
const Dashboard = lazy(() => import('./admin/Dashboard').then(m => ({ default: m.Dashboard })));
const AccountManagement = lazy(() => import('./admin/AccountManagement').then(m => ({ default: m.AccountManagement })));
const SessionControl = lazy(() => import('./admin/SessionControl').then(m => ({ default: m.SessionControl })));
const EntryLimits = lazy(() => import('./admin/EntryLimits').then(m => ({ default: m.EntryLimits })));
const TotalData = lazy(() => import('./admin/TotalData').then(m => ({ default: m.TotalData })));
const WinningNumber = lazy(() => import('./admin/WinningNumber').then(m => ({ default: m.WinningNumber })));
const AdminReports = lazy(() => import('./admin/AdminReports').then(m => ({ default: m.AdminReports })));
const AdminProfile = lazy(() => import('./admin/AdminProfile').then(m => ({ default: m.AdminProfile })));

function PageFallback() {
  return <p style={{ color: C.textMuted, fontSize: 13, padding: 24 }}>Loading…</p>;
}

type AdminPage = 'dashboard' | 'accounts' | 'sessions' | 'limits' | 'totaldata' | 'winning' | 'reports' | 'profile';

const NAV: { id: AdminPage; label: string; icon: any }[] = [
  { id: 'dashboard', label: 'Dashboard',      icon: LayoutDashboard },
  { id: 'accounts',  label: 'Accounts',       icon: Users },
  { id: 'sessions',  label: 'Session',        icon: CalendarClock },
  { id: 'limits',    label: 'Entry Limits',   icon: ListOrdered },
  { id: 'totaldata', label: 'Total Data',     icon: BarChart3 },
  { id: 'winning',   label: 'Winning Number', icon: Trophy },
  { id: 'reports',   label: 'Reports',        icon: FileText },
  { id: 'profile',   label: 'Profile',        icon: UserCircle },
];

export function AdminLayout() {
  const { role, session, users, partners, logout: logoutAction } = useApp();
  const [page, setPage] = useState<AdminPage>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isMasterAdmin = role === 'masterAdmin';

  const logout = () => { logoutAction(); };

  const navLabel = NAV.find(n => n.id === page)?.label ?? '';

  const Sidebar = () => (
    <aside className="flex flex-col h-full"
      style={{ background: 'linear-gradient(180deg, #0F1728 0%, #07080D 100%)', borderRight: `1px solid ${C.border}` }}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5" style={{ borderBottom: `1px solid ${C.border}` }}>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: C.goldGrad }}>
          <span style={{ fontSize: 16 }}>♦</span>
        </div>
        <div>
          <p style={{ color: C.gold, fontSize: 15, fontWeight: 800, letterSpacing: '0.1em', lineHeight: 1 }}>TREASURE</p>
          <p style={{ color: C.textDim, fontSize: 10, marginTop: 2, letterSpacing: '0.04em' }}>
            {isMasterAdmin ? 'Master Admin' : 'Admin Panel'}
          </p>
        </div>
      </div>

      {/* Session pill */}
      <div className="mx-3 mt-3 px-3 py-2 rounded-lg flex items-center gap-2"
        style={{ background: session.status === 'open' ? C.greenBg : C.redBg }}>
        <div className="w-1.5 h-1.5 rounded-full" style={{ background: session.status === 'open' ? C.green : C.red }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: session.status === 'open' ? C.greenText : C.redText }}>
          SESSION {session.status.toUpperCase()}
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {NAV.map(({ id, label, icon: Icon }) => {
          const active = page === id;
          return (
            <button key={id}
              onClick={() => { setPage(id); setSidebarOpen(false); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left"
              style={{
                background: active ? C.goldDim : 'transparent',
                color: active ? C.gold : C.textMuted,
                border: active ? `1px solid ${C.border}` : '1px solid transparent',
                cursor: 'pointer',
              }}>
              <Icon size={16} />
              <span style={{ fontSize: 13, fontWeight: active ? 600 : 400 }}>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 pb-4 space-y-2" style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
        <div className="px-3 py-2 rounded-lg" style={{ background: C.card2 }}>
          <div className="flex items-center gap-2">
            {isMasterAdmin && <Shield size={12} color={C.gold} />}
            <p style={{ color: C.text, fontSize: 12, fontWeight: 600 }}>
              {isMasterAdmin ? 'master' : 'admin'}
            </p>
          </div>
          <p style={{ color: C.textDim, fontSize: 10, marginTop: 1 }}>
            {users.filter(u => u.isActive).length}U · {partners.filter(p => p.isActive).length}P managed
          </p>
        </div>
        <button onClick={logout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl transition-all"
          style={{ color: C.textMuted, cursor: 'pointer', background: 'transparent', border: 'none' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.red; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.textMuted; }}>
          <LogOut size={14} />
          <span style={{ fontSize: 13 }}>Sign Out</span>
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: C.bg, color: C.text }}>
      {/* Desktop sidebar */}
      <div className="hidden md:flex flex-col w-56 flex-shrink-0 h-full">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="fixed inset-0" style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={() => setSidebarOpen(false)} />
          <div className="relative w-56 h-full z-50">
            <Sidebar />
          </div>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center gap-4 px-5 py-3 flex-shrink-0"
          style={{ background: C.card, borderBottom: `1px solid ${C.border}` }}>
          <button className="md:hidden" onClick={() => setSidebarOpen(true)}
            style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', padding: 4 }}>
            <Menu size={20} />
          </button>
          <h1 style={{ color: C.text, fontSize: 15, fontWeight: 700, flex: 1 }}>{navLabel}</h1>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: C.goldDim }}>
            <span style={{ color: C.gold, fontSize: 11, fontWeight: 700, letterSpacing: '0.05em' }}>
              {session.label}
            </span>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Suspense fallback={<PageFallback />}>
            {page === 'dashboard'  && <Dashboard />}
            {page === 'accounts'   && <AccountManagement />}
            {page === 'sessions'   && <SessionControl />}
            {page === 'limits'     && <EntryLimits />}
            {page === 'totaldata'  && <TotalData />}
            {page === 'winning'    && <WinningNumber />}
            {page === 'reports'    && <AdminReports />}
            {page === 'profile'    && <AdminProfile />}
          </Suspense>
        </main>
      </div>
    </div>
  );
}
