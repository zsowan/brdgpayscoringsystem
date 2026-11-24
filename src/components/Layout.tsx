import { NavLink, Outlet } from 'react-router-dom';
import { useConfigStore } from '../hooks/ConfigContext';

const NAV_ITEMS: { to: string; label: string; icon: string }[] = [
  { to: '/', label: 'Dashboard', icon: '◈' },
  { to: '/playground', label: 'Customer Playground', icon: '▶' },
  { to: '/segments', label: 'Segments', icon: '▤' },
  { to: '/decision-engine', label: 'Decision Engine', icon: '≡' },
];

// Supporting/technical configuration — not part of the primary Decision Engine demo flow.
const ADVANCED_NAV_ITEMS: { to: string; label: string; icon: string }[] = [
  { to: '/preapproved-marketing', label: 'Preapproved Marketing List', icon: '★' },
  { to: '/customer-fields', label: 'Customer Data Fields', icon: '▦' },
  { to: '/integrations', label: 'Integration Simulator', icon: '⇄' },
  { to: '/config-versions', label: 'Configuration Versions', icon: '❖' },
  { to: '/decision-history', label: 'Decision History', icon: '🕐' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

export default function Layout() {
  const { activeConfig } = useConfigStore();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">BRDG Pay</div>
        <div className="sidebar-section-label">Playground</div>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
          >
            <span className="sidebar-icon">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
        <div className="sidebar-section-label">Advanced Configuration</div>
        {ADVANCED_NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
          >
            <span className="sidebar-icon">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-title">
            BRDG Pay
            <span className="badge-playground">PLAYGROUND</span>
          </div>
          <div className="topbar-right">
            <span>Active Configuration:</span>
            <strong style={{ color: 'var(--ink)' }}>{activeConfig?.versionLabel ?? '—'}</strong>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
