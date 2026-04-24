import { Home, ScrollText, Users, Settings } from 'lucide-react';

export type Tab = 'home' | 'audit' | 'parents' | 'settings';

const TABS: { id: Tab; icon: React.ReactNode; label: string }[] = [
  { id: 'home', icon: <Home size={20} />, label: 'Home' },
  { id: 'audit', icon: <ScrollText size={20} />, label: 'Audit' },
  { id: 'parents', icon: <Users size={20} />, label: 'Parents' },
  { id: 'settings', icon: <Settings size={20} />, label: 'Settings' },
];

export function SideNav({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <nav
      className="hidden md:flex flex-col gap-1 px-2 py-6 shrink-0"
      style={{
        width: 64,
        borderRight: '1px solid var(--hairline)',
        background: 'var(--panel-solid)',
        position: 'sticky',
        top: 0,
        height: '100dvh',
      }}
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          title={t.label}
          className="flex items-center justify-center rounded-xl p-3 transition-colors"
          style={{
            color: active === t.id ? 'var(--text)' : 'var(--muted)',
            background: active === t.id ? 'var(--surface-sub)' : 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          {t.icon}
        </button>
      ))}
    </nav>
  );
}
