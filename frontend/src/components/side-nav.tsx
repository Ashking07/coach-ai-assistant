import { Home, ListTree, Users, Settings } from 'lucide-react';
import { T } from '../tokens';

export type Tab = 'home' | 'audit' | 'parents' | 'settings';

const ITEMS: { id: Tab; label: string; Icon: typeof Home }[] = [
  { id: 'home',     label: 'Home',     Icon: Home     },
  { id: 'audit',   label: 'Audit',    Icon: ListTree  },
  { id: 'parents', label: 'Parents',  Icon: Users     },
  { id: 'settings',label: 'Settings', Icon: Settings  },
];

export function SideNav({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <aside
      className="hidden md:flex flex-col gap-1 p-4"
      style={{
        width: 220,
        borderRight: '1px solid var(--hairline)',
        height: '100dvh',
        position: 'sticky',
        top: 0,
      }}
    >
      <div
        style={{
          fontFamily: 'Fraunces, serif',
          fontSize: 22,
          fontWeight: 500,
          color: 'var(--text)',
          padding: '4px 8px 20px',
        }}
      >
        cockpit<span style={{ color: T.sunrise }}>.</span>
      </div>

      {ITEMS.map(({ id, label, Icon }) => {
        const on = active === id;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className="flex items-center gap-3 rounded-xl text-left transition-colors"
            style={{
              padding: '10px 12px',
              background: on ? T.sunrise + '16' : 'transparent',
              color: on ? T.sunrise : 'var(--text)',
              fontSize: 14,
              border: 'none',
              cursor: 'pointer',
              width: '100%',
            }}
          >
            <Icon size={17} />
            {label}
          </button>
        );
      })}

      <div
        className="mt-auto"
        style={{
          fontFamily: 'Geist Mono, monospace',
          fontSize: 10,
          color: 'var(--muted)',
          padding: '12px 8px',
          borderTop: '1px solid var(--hairline)',
          letterSpacing: '0.06em',
        }}
      >
        J/K navigate · E send · Esc dismiss
      </div>
    </aside>
  );
}
