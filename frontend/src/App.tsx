import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SideNav, type Tab } from './components/side-nav';
import { BottomTabBar } from './components/bottom-tab-bar';
import { HomeScreen } from './components/screens/home';
import { AuditScreen } from './components/screens/audit';
import { ParentsScreen } from './components/screens/parents';
import { FinancialsScreen } from './components/screens/financials';
import { SettingsScreen } from './components/screens/settings';
import { api } from './lib/api';
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
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings,
    refetchInterval: 60_000,
  });

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

      <main className="flex-1 min-w-0 flex flex-col">
        {(settings?.agentPaused ?? false) && (
          <div
            className="px-4 md:px-8 py-3 text-center"
            style={{
              background: 'rgba(244, 67, 54, 0.08)',
              borderBottom: '1px solid rgba(244, 67, 54, 0.2)',
              fontFamily: 'Geist Mono, monospace',
              fontSize: 12,
              letterSpacing: '0.08em',
              color: '#F44336',
              textTransform: 'uppercase',
            }}
          >
            ⏸ PAUSED — Agent processing is disabled
          </div>
        )}
        <div className="flex-1 min-w-0">
          {tab === 'home' && <HomeScreen theme={theme} onToggleTheme={toggleTheme} />}
          {tab === 'audit' && <AuditScreen />}
          {tab === 'parents' && <ParentsScreen />}
          {tab === 'financials' && <FinancialsScreen />}
          {tab === 'settings' && <SettingsScreen />}
        </div>
      </main>

      <BottomTabBar active={tab} onChange={setTab} />
    </div>
  );
}
