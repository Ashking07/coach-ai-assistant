import { useMemo, useState } from 'react';
import { SideNav, type Tab } from './components/side-nav';
import { BottomTabBar } from './components/bottom-tab-bar';
import { HomeScreen } from './components/screens/home';
import { AuditScreen } from './components/screens/audit';
import { ParentsScreen } from './components/screens/parents';
import { SettingsScreen } from './components/screens/settings';
import { darkVars, lightVars } from './tokens';

type Theme = 'dark' | 'light';

function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem('coach-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {}
  return 'dark';
}

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  const themeStyle = useMemo(
    () => (theme === 'dark' ? darkVars : lightVars) as React.CSSProperties,
    [theme],
  );

  const toggleTheme = () => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('coach-theme', next); } catch {}
      return next;
    });
  };

  return (
    <div
      className="min-h-dvh flex"
      style={{
        ...themeStyle,
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'Inter Tight, system-ui, sans-serif',
      }}
    >
      <SideNav active={tab} onChange={setTab} />

      <main className="flex-1 min-w-0">
        {tab === 'home' && <HomeScreen theme={theme} onToggleTheme={toggleTheme} />}
        {tab === 'audit' && <AuditScreen />}
        {tab === 'parents' && <ParentsScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </main>

      <BottomTabBar active={tab} onChange={setTab} />
    </div>
  );
}
