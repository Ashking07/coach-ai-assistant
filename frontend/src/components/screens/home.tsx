import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Sun, Moon } from 'lucide-react';
import { useState } from 'react';
import { api, type Approval, type HomeResponse } from '../../lib/api';
import { T } from '../../tokens';
import { FireCard, ApprovalCard, SessionCard } from '../cards';
import { ApprovalDetail } from '../approval-detail';
import { IntentBadge } from '../badges';

function SectionLabel({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="px-4 md:px-8 mt-6 mb-3 flex items-baseline gap-2">
      <h2
        style={{
          fontFamily: 'Inter Tight, sans-serif',
          fontSize: 15,
          fontWeight: 500,
          color: 'var(--text)',
          letterSpacing: '-0.01em',
          margin: 0,
        }}
      >
        {children}
      </h2>
      {count !== undefined && (
        <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--muted)' }}>
          {count}
        </span>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="px-4 md:px-8 mt-4 flex flex-col gap-3">
      {[1, 2].map((i) => (
        <div
          key={i}
          className="animate-pulse rounded-2xl h-24"
          style={{ background: 'var(--surface-sub)' }}
        />
      ))}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="px-4 md:px-8 mt-6">
      <div
        className="rounded-2xl p-6 flex items-center gap-3"
        style={{ background: 'var(--panel)', border: '1px solid var(--hairline)' }}
      >
        <span
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: T.moss + '22', color: T.moss }}
        >
          ✓
        </span>
        <div style={{ color: 'var(--text)', fontSize: 14 }}>{label}</div>
      </div>
    </div>
  );
}

function AutoHandledSection({ data }: { data: HomeResponse['autoHandled'] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-4 md:px-8 mt-6 mb-24 md:mb-10">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-3"
        style={{
          borderTop: '1px solid var(--hairline)',
          borderBottom: open ? 'none' : '1px solid var(--hairline)',
          background: 'none',
          cursor: 'pointer',
        }}
      >
        <div className="flex items-center gap-2.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: T.moss }} />
          <span style={{ color: 'var(--text)', fontSize: 14 }}>Auto-handled</span>
          <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: T.moss }}>
            {data.length} overnight
          </span>
        </div>
        <ChevronDown
          size={16}
          style={{
            color: 'var(--muted)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s',
          }}
        />
      </button>
      {open && (
        <div style={{ borderBottom: '1px solid var(--hairline)' }} className="pb-1">
          {data.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-3 py-2.5"
              style={{ borderTop: '1px solid var(--hairline)' }}
            >
              <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--muted)', width: 46 }}>
                {a.time}
              </span>
              <div className="flex-1 min-w-0">
                <div className="truncate" style={{ color: 'var(--text)', fontSize: 14 }}>
                  {a.parent} <span style={{ color: 'var(--muted)' }}>· {a.kid}</span>
                </div>
                <div className="truncate" style={{ color: 'var(--muted)', fontSize: 13 }}>
                  {a.summary}
                </div>
              </div>
              <IntentBadge intent={a.intent} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function HomeScreen({
  theme,
  onToggleTheme,
}: {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['home'],
    queryFn: api.home,
    refetchInterval: 30_000,
  });

  const [activeApproval, setActiveApproval] = useState<Approval | null>(null);

  const sendMutation = useMutation({
    mutationFn: (id: string) => api.sendApproval(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['home'] });
      const prev = queryClient.getQueryData<HomeResponse>(['home']);
      queryClient.setQueryData<HomeResponse>(['home'], (old) =>
        old ? { ...old, approvals: old.approvals.filter((a) => a.id !== id) } : old,
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['home'], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['home'] }),
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => api.dismissApproval(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['home'] });
      const prev = queryClient.getQueryData<HomeResponse>(['home']);
      queryClient.setQueryData<HomeResponse>(['home'], (old) =>
        old ? { ...old, approvals: old.approvals.filter((a) => a.id !== id) } : old,
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['home'], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['home'] }),
  });

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const day = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  return (
    <div>
      {/* Greeting */}
      <div className="px-4 pt-8 pb-4 md:px-8 md:pt-10 flex items-start justify-between gap-4">
        <div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: 28, lineHeight: 1.15, color: 'var(--text)', margin: 0 }}>
            {day} {greet}, Coach.
          </h1>
          <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12, color: 'var(--muted)', marginTop: 6, letterSpacing: '0.02em' }}>
            {data ? `${data.stats.firesCount} need you · ${data.stats.handledCount} handled overnight` : '—'}
          </div>
        </div>
        <button
          onClick={onToggleTheme}
          className="p-2 rounded-full shrink-0"
          style={{ border: '1px solid var(--hairline)', color: 'var(--muted)', background: 'none', cursor: 'pointer' }}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      {isLoading && <Skeleton />}

      {isError && (
        <div className="px-4 md:px-8 mt-4">
          <button
            onClick={() => void refetch()}
            className="text-sm underline"
            style={{ color: T.terracotta }}
          >
            Failed to load — tap to retry
          </button>
        </div>
      )}

      {data && (
        <>
          {/* Fires */}
          {data.fires.length > 0 && (
            <>
              <SectionLabel count={data.fires.length}>Needs you.</SectionLabel>
              <div className="px-4 md:px-8 flex flex-col gap-3 md:grid md:grid-cols-2 md:gap-4">
                {data.fires.map((f) => (
                  <FireCard key={f.id} fire={f} onOpen={() => {}} />
                ))}
              </div>
            </>
          )}

          {/* Approvals */}
          {data.approvals.length > 0 ? (
            <>
              <SectionLabel count={data.approvals.length}>Drafted for your tap.</SectionLabel>
              <div className="px-4 md:px-8 flex flex-col gap-3 md:grid md:grid-cols-2 md:gap-4">
                {data.approvals.map((a) => (
                  <ApprovalCard
                    key={a.id}
                    approval={a}
                    onSend={() => sendMutation.mutate(a.id)}
                    onEdit={() => setActiveApproval(a)}
                  />
                ))}
              </div>
            </>
          ) : data.fires.length === 0 ? (
            <EmptyState label="Inbox is quiet. Nothing needs you right now." />
          ) : null}

          {/* Sessions */}
          {data.sessions.length > 0 && (
            <>
              <SectionLabel count={data.sessions.length}>Today.</SectionLabel>
              <div className="px-4 md:px-8 flex gap-3 overflow-x-auto pb-2">
                {data.sessions.map((s) => (
                  <SessionCard key={s.id} session={s} onOpen={() => {}} />
                ))}
              </div>
            </>
          )}

          {/* Auto-handled */}
          <AutoHandledSection data={data.autoHandled} />
        </>
      )}

      {/* Approval detail overlay */}
      {activeApproval && (
        <ApprovalDetail
          approval={activeApproval}
          onClose={() => setActiveApproval(null)}
          onSend={() => {
            sendMutation.mutate(activeApproval.id);
            setActiveApproval(null);
          }}
          onDismiss={() => {
            dismissMutation.mutate(activeApproval.id);
            setActiveApproval(null);
          }}
        />
      )}
    </div>
  );
}
