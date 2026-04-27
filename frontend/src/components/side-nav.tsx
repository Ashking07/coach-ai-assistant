import { useState } from 'react';
import { Home, ListTree, Users, Settings, ChevronLeft, ChevronRight } from 'lucide-react';
import { T } from '../tokens';

export type Tab = 'home' | 'audit' | 'parents' | 'settings';

const ITEMS: { id: Tab; label: string; Icon: typeof Home }[] = [
  { id: 'home',     label: 'Home',     Icon: Home     },
  { id: 'audit',   label: 'Audit',    Icon: ListTree  },
  { id: 'parents', label: 'Parents',  Icon: Users     },
  { id: 'settings',label: 'Settings', Icon: Settings  },
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
    <aside
      className="hidden md:flex flex-col gap-1 p-4"
      style={{
        width: expanded ? 220 : 60,
        borderRight: '1px solid var(--hairline)',
        height: '100dvh',
        position: 'sticky',
        top: 0,
        transition: 'width 0.2s ease',
        overflow: 'hidden',
      }}
    >
      {/* Brand */}
      <div
        style={{
          fontFamily: 'Fraunces, serif',
          fontSize: 22,
          fontWeight: 500,
          color: 'var(--text)',
          padding: '4px 8px 20px',
          whiteSpace: 'nowrap',
        }}
      >
        {expanded ? (
          <>cockpit<span style={{ color: T.sunrise }}>.</span></>
        ) : (
          <span style={{ color: T.sunrise }}>·</span>
        )}
      </div>

      {/* Nav items */}
      {ITEMS.map(({ id, label, Icon }) => {
        const on = active === id;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            title={expanded ? undefined : label}
            className="flex items-center rounded-xl transition-colors"
            style={{
              gap: expanded ? 12 : 0,
              padding: expanded ? '10px 12px' : '10px 0',
              justifyContent: expanded ? 'flex-start' : 'center',
              background: on ? T.sunrise + '16' : 'transparent',
              color: on ? T.sunrise : 'var(--text)',
              fontSize: 14,
              border: 'none',
              cursor: 'pointer',
              width: '100%',
              whiteSpace: 'nowrap',
              textAlign: 'left',
            }}
          >
            <Icon size={17} style={{ flexShrink: 0 }} />
            {expanded && label}
          </button>
        );
      })}

      {/* Keyboard hint */}
      {expanded && (
        <div
          className="mt-auto"
          style={{
            fontFamily: 'Geist Mono, monospace',
            fontSize: 10,
            color: 'var(--muted)',
            padding: '12px 8px 4px',
            borderTop: '1px solid var(--hairline)',
            letterSpacing: '0.06em',
            whiteSpace: 'nowrap',
          }}
        >
          J/K navigate · E send · Esc dismiss
        </div>
      )}

      {/* Collapse toggle */}
      <button
        onClick={toggle}
        title={expanded ? 'Collapse' : 'Expand'}
        className="flex items-center rounded-xl transition-colors"
        style={{
          marginTop: expanded ? 8 : 'auto',
          gap: expanded ? 10 : 0,
          padding: expanded ? '8px 12px' : '8px 0',
          justifyContent: expanded ? 'flex-start' : 'center',
          color: 'var(--muted)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          width: '100%',
          fontSize: 12,
          whiteSpace: 'nowrap',
        }}
      >
        {expanded ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
        {expanded && 'Collapse'}
      </button>
    </aside>
  );
}
