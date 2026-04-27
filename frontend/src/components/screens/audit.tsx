import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { T } from '../../tokens';
import { IntentBadge, TierBadge } from '../badges';

type Filter = 'all' | 'auto' | 'approve' | 'escalate';

const CHIPS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'auto', label: 'Auto-sent' },
  { id: 'approve', label: 'Approved' },
  { id: 'escalate', label: 'Escalated' },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'Geist Mono, monospace', letterSpacing: '0.08em', marginBottom: 6 }}>
        {label}
      </div>
      <div
        className="rounded-lg p-3"
        style={{ background: 'var(--surface-sub)', color: 'var(--text)', fontSize: 14, border: '1px solid var(--hairline)', lineHeight: 1.5 }}
      >
        {children}
      </div>
    </div>
  );
}

export function AuditScreen() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['audit'],
    queryFn: api.audit,
  });

  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = (data ?? []).filter((e) => {
    if (filter === 'all') return true;
    if (filter === 'auto') return e.action === 'AUTO_SENT';
    if (filter === 'approve') return e.action === 'QUEUED_FOR_APPROVAL';
    if (filter === 'escalate') return e.action === 'ESCALATED';
    return true;
  });

  return (
    <div className="pb-24 md:pb-10">
      <div className="px-4 pt-8 pb-4 md:px-8 md:pt-10">
        <h1 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: 28, color: 'var(--text)', margin: 0 }}>
          Audit log.
        </h1>
        <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
          Every decision the agent made on your behalf. Append-only.
        </div>
      </div>

      {/* Filter chips */}
      <div className="px-4 md:px-8 flex gap-2 overflow-x-auto pb-3">
        {CHIPS.map((c) => (
          <button
            key={c.id}
            onClick={() => setFilter(c.id)}
            className="px-3 py-1.5 rounded-full shrink-0"
            style={{
              fontSize: 13,
              fontFamily: 'Geist Mono, monospace',
              background: filter === c.id ? T.sunrise + '18' : 'transparent',
              color: filter === c.id ? T.sunrise : 'var(--muted)',
              border: `1px solid ${filter === c.id ? T.sunrise + '55' : 'var(--hairline)'}`,
              cursor: 'pointer',
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="px-4 md:px-8 flex flex-col gap-2 mt-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="animate-pulse rounded h-12" style={{ background: 'var(--surface-sub)' }} />
          ))}
        </div>
      )}

      {isError && (
        <div className="px-4 md:px-8 mt-4">
          <button onClick={() => void refetch()} className="text-sm underline" style={{ color: T.terracotta }}>
            Failed to load — tap to retry
          </button>
        </div>
      )}

      <div className="md:px-8">
        {filtered.length === 0 && !isLoading && (
          <div className="px-4 md:px-4 mt-8">
            <div
              className="rounded-2xl p-8 flex flex-col items-center gap-3 text-center"
              style={{ background: 'var(--panel)', border: '1px solid var(--hairline)' }}
            >
              <span style={{ color: 'var(--muted)', fontSize: 14 }}>No messages yet.</span>
            </div>
          </div>
        )}
        {filtered.map((e) => {
          const isOpen = expanded === e.id;
          return (
            <div key={e.id} style={{ borderTop: '1px solid var(--hairline)' }}>
              <button
                className="w-full flex items-center gap-3 px-4 md:px-4 py-3 text-left"
                onClick={() => setExpanded(isOpen ? null : e.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', width: '100%' }}
              >
                <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--muted)', width: 150, flexShrink: 0 }} className="hidden md:inline-block">
                  {e.ts}
                </span>
                <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 10, color: 'var(--muted)' }} className="md:hidden">
                  {e.ts.split(' ')[1]}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="truncate" style={{ color: 'var(--text)', fontSize: 14 }}>
                    {e.parent} <span style={{ color: 'var(--muted)' }}>· {e.kid}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <TierBadge tier={e.tier} />
                    <IntentBadge intent={e.intent} />
                    <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>
                      {e.action}
                    </span>
                  </div>
                </div>
                <div className="hidden md:flex flex-col items-end" style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--muted)' }}>
                  <span>{e.model}</span>
                  <span>{e.tokens} tok · {e.latencyMs}ms</span>
                </div>
                <ChevronRight size={16} style={{ color: 'var(--muted)', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }} />
              </button>

              {isOpen && (
                <div className="px-4 md:px-4 pb-4 flex flex-col gap-3" style={{ background: 'var(--panel)' }}>
                  <Field label="INCOMING">{e.incoming}</Field>
                  <Field label="DRAFT">{e.draft}</Field>
                  <div>
                    <div style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'Geist Mono, monospace', letterSpacing: '0.08em', marginBottom: 6 }}>
                      REASONING CHAIN
                    </div>
                    <div className="flex flex-col gap-1">
                      {e.trace.map((t, i) => (
                        <div key={i} className="flex justify-between gap-3" style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12 }}>
                          <span style={{ color: 'var(--muted)' }}>→ {t.step}</span>
                          <span style={{ color: 'var(--text)', textAlign: 'right' }}>{t.verdict}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="md:hidden" style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--muted)' }}>
                    {e.model} · {e.tokens} tok · {e.latencyMs}ms
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div style={{ borderTop: '1px solid var(--hairline)' }} />
      </div>
    </div>
  );
}
