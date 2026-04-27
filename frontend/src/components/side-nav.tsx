import { useState } from 'react';
import { Home, ScrollText, Users, Settings, ChevronLeft, ChevronRight } from 'lucide-react';

export type Tab = 'home' | 'audit' | 'parents' | 'settings';

const TABS: { id: Tab; icon: React.ReactNode; label: string }[] = [
  { id: 'home', icon: <Home size={20} />, label: 'Home' },
  { id: 'audit', icon: <ScrollText size={20} />, label: 'Audit' },
  { id: 'parents', icon: <Users size={20} />, label: 'Parents' },
  { id: 'settings', icon: <Settings size={20} />, label: 'Settings' },
];

function getInitialExpanded(): boolean {
  try {
    const saved = localStorage.getItem('coach-nav-expanded');
    if (saved === 'false') return false;
  } catch {}
  return true;
}

export function SideNav({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
}) {
  const [expanded, setExpanded] = useState(getInitialExpanded);

  const toggle = () => {
    setExpanded((v) => {
      const next = !v;
      try { localStorage.setItem('coach-nav-expanded', String(next)); } catch {}
      return next;
    });
  };

  return (
    <nav
      className="hidden md:flex flex-col shrink-0"
      style={{
        width: expanded ? 200 : 64,
        borderRight: '1px solid var(--hairline)',
        background: 'var(--panel-solid)',
        position: 'sticky',
        top: 0,
        height: '100dvh',
        transition: 'width 0.2s ease',
        overflow: 'hidden',
      }}
    >
      {/* Logo / brand area */}
      <div
        className="flex items-center px-4 py-5 shrink-0"
        style={{
          borderBottom: '1px solid var(--hairline)',
          minHeight: 60,
          overflow: 'hidden',
        }}
      >
        {expanded ? (
          <span
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 15,
              fontWeight: 500,
              color: 'var(--text)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            Coach AI
          </span>
        ) : (
          <span style={{ fontSize: 18 }}>🎾</span>
        )}
      </div>

      {/* Nav items */}
      <div className="flex flex-col gap-1 px-2 py-4 flex-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            title={expanded ? undefined : t.label}
            className="flex items-center rounded-xl transition-colors"
            style={{
              gap: 10,
              padding: expanded ? '10px 12px' : '10px 0',
              justifyContent: expanded ? 'flex-start' : 'center',
              color: active === t.id ? 'var(--text)' : 'var(--muted)',
              background: active === t.id ? 'var(--surface-sub)' : 'transparent',
              border: 'none',
              cursor: 'pointer',
              width: '100%',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            <span style={{ flexShrink: 0 }}>{t.icon}</span>
            {expanded && (
              <span style={{ fontSize: 14, fontWeight: active === t.id ? 500 : 400 }}>
                {t.label}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Collapse toggle */}
      <div className="px-2 pb-5 shrink-0">
        <button
          onClick={toggle}
          title={expanded ? 'Collapse' : 'Expand'}
          className="flex items-center rounded-xl w-full transition-colors"
          style={{
            gap: 10,
            padding: expanded ? '10px 12px' : '10px 0',
            justifyContent: expanded ? 'flex-start' : 'center',
            color: 'var(--muted)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          {expanded ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
          {expanded && <span style={{ fontSize: 13 }}>Collapse</span>}
        </button>
      </div>
    </nav>
  );
}
