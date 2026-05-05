import { Home, ScrollText, Users, Settings, TrendingUp } from 'lucide-react';
import type { Tab } from './side-nav';

const TABS: { id: Tab; icon: React.ReactNode; label: string }[] = [
  { id: 'home',       icon: <Home size={22} />,       label: 'Home'   },
  { id: 'audit',      icon: <ScrollText size={22} />, label: 'Audit'  },
  { id: 'parents',    icon: <Users size={22} />,      label: 'Parents'},
  { id: 'financials', icon: <TrendingUp size={22} />, label: 'Money'  },
  { id: 'settings',   icon: <Settings size={22} />,   label: 'Settings'},
];

export function BottomTabBar({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 flex border-t"
      style={{
        background: 'var(--panel-solid)',
        borderColor: 'var(--hairline)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        zIndex: 30,
      }}
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className="flex-1 flex flex-col items-center gap-1 py-3"
          style={{
            color: active === t.id ? 'var(--text)' : 'var(--muted)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 10,
            fontFamily: 'Inter Tight, sans-serif',
          }}
        >
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
