import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, MessageSquare, Sun, Moon, X } from 'lucide-react';
import { useState } from 'react';
import { api, type Approval, type Fire, type HomeResponse } from '../../lib/api';
import { T } from '../../tokens';
import { FireCard, ApprovalCard } from '../cards';
import { ApprovalDetail } from '../approval-detail';
import { IntentBadge } from '../badges';
import { DemoQRCard } from '../demo-qr-card';
import { WeekView } from '../week-view';
import { VoiceButton } from '../voice/voice-button';

const REASON_TEXT: Record<string, string> = {
  ESCALATED: 'Policy exception detected — this message touched a topic the agent is not allowed to auto-answer on your behalf. Needs your voice.',
  CLASSIFY_FAILED: 'Classification failed — the agent could not reliably determine the intent of this message and escalated rather than guess.',
  DRAFT_FAILED: 'Draft failed — the agent classified the message but could not produce a reply that passed its own quality checks.',
  SEND_FAILED: 'Send failed — a reply was drafted and approved, but delivery failed. Check the thread and retry manually.',
};

function FireDetail({ fire, onClose, onResolve }: { fire: Fire; onClose: () => void; onResolve: () => void }) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 md:p-8"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', zIndex: 60 }}
      onClick={onClose}
    >
      <style>{`
        @keyframes fireFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fireSlideUp { from { transform: translateY(24px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col w-full rounded-3xl overflow-hidden"
        style={{
          background: '#0E0F0C',
          border: '1px solid #2A2B27',
          maxWidth: 520,
          maxHeight: 'min(720px, 92dvh)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
          animation: 'fireSlideUp 0.28s ease-out',
        }}
      >
        {/* Header */}
        <div
          className="sticky top-0 flex items-center justify-between px-5 py-4"
          style={{ background: 'rgba(14,15,12,0.92)', backdropFilter: 'blur(20px)', borderBottom: '1px solid #2A2B27' }}
        >
          <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, letterSpacing: '0.1em', color: '#A8A49B', textTransform: 'uppercase' }}>
            Needs your attention
          </span>
          <button onClick={onClose} className="p-2 -mr-2 rounded-full" style={{ color: '#A8A49B', background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 md:px-6 py-6 flex flex-col gap-6 pb-44">
          <div>
            <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 26, fontWeight: 500, color: '#F7F3EC', lineHeight: 1.2, margin: 0 }}>
              {fire.parent}
            </h1>
            <div className="flex items-center gap-2 mt-2" style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11 }}>
              <span style={{ color: T.terracotta, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                <IntentBadge intent={fire.intent} />
              </span>
              <span style={{ color: '#A8A49B' }}>·</span>
              <span style={{ color: '#A8A49B' }}>{fire.ago} ago</span>
              <span style={{ color: '#A8A49B' }}>·</span>
              <span style={{ color: '#A8A49B' }}>{fire.kid}</span>
            </div>
          </div>

          {/* Urgency strip */}
          <div
            className="flex items-center gap-3 rounded-2xl px-4 py-3"
            style={{ background: T.terracotta + '1F', border: `1px solid ${T.terracotta}40` }}
          >
            <AlertTriangle size={18} style={{ color: T.terracotta, flexShrink: 0 }} />
            <span style={{ color: '#F7F3EC', fontSize: 14, lineHeight: 1.45 }}>
              Escalated — requires your personal reply
            </span>
          </div>

          <FireSection label="Message">
            <div className="rounded-2xl px-4 py-4" style={{ background: 'rgba(247,243,236,0.04)', border: '1px solid #2A2B27', color: '#F7F3EC', fontSize: 15, lineHeight: 1.55 }}>
              {fire.preview}
            </div>
          </FireSection>

          <FireSection label="Reason">
            <div
              className="rounded-2xl px-4 py-4"
              style={{ background: T.terracotta + '14', border: `1px solid ${T.terracotta}30`, borderLeftWidth: 3, borderLeftColor: T.terracotta, color: '#F7F3EC', fontSize: 14, lineHeight: 1.55 }}
            >
              {REASON_TEXT[fire.reason] ?? fire.reason}
            </div>
          </FireSection>

          <FireSection label="Recommended action">
            <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12, color: '#A8A49B', lineHeight: 1.6 }}>
              → open SMS thread with {fire.parent.split(' ')[0]}<br />
              → respond personally in your own voice<br />
              → mark resolved when conversation is closed
            </div>
          </FireSection>
        </div>

        {/* Action buttons */}
        <div
          className="absolute bottom-0 left-0 right-0 px-5 pt-6 pb-5 flex flex-col gap-2"
          style={{ background: 'linear-gradient(to top, #0E0F0C 60%, rgba(14,15,12,0.85) 85%, rgba(14,15,12,0))' }}
        >
          <button
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl"
            style={{ background: T.sunrise, color: '#F7F3EC', fontSize: 15, border: 'none', cursor: 'pointer' }}
          >
            <MessageSquare size={16} />
            Reply via SMS
          </button>
          <button
            onClick={onResolve}
            className="w-full py-3 rounded-2xl"
            style={{ background: 'rgba(247,243,236,0.05)', border: '1px solid #2A2B27', color: '#A8A49B', fontSize: 14, cursor: 'pointer' }}
          >
            Mark resolved
          </button>
        </div>
      </div>
    </div>
  );
}

function FireSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 10, letterSpacing: '0.12em', color: '#A8A49B', textTransform: 'uppercase' }}>
        {label}
      </span>
      {children}
    </div>
  );
}

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

  const [activeFire, setActiveFire] = useState<Fire | null>(null);
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
        <div className="flex items-center gap-2 shrink-0">
          <VoiceButton />
          <button
            onClick={onToggleTheme}
            className="p-2 rounded-full shrink-0"
            style={{ border: '1px solid var(--hairline)', color: 'var(--muted)', background: 'none', cursor: 'pointer' }}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
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
                  <FireCard
                    key={f.id}
                    fire={f}
                    onOpen={() => setActiveFire(f)}
                    onDismiss={() =>
                      queryClient.setQueryData<typeof data>(['dashboard', 'home'], (old) =>
                        old ? { ...old, fires: old.fires.filter((x) => x.id !== f.id) } : old,
                      )
                    }
                  />
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

          {/* Week view */}
          <WeekView sessions={data.sessions} />

          {/* Auto-handled */}
          <AutoHandledSection data={data.autoHandled} />
        </>
      )}

      {/* Demo QR */}
      <SectionLabel count={0}>Demo.</SectionLabel>
      <DemoQRCard />

      {/* Approval detail overlay */}
      {activeFire && (
        <FireDetail
          fire={activeFire}
          onClose={() => setActiveFire(null)}
          onResolve={() => {
            queryClient.setQueryData<typeof data>(['dashboard', 'home'], (old) =>
              old ? { ...old, fires: old.fires.filter((f) => f.id !== activeFire.id) } : old,
            );
            setActiveFire(null);
          }}
        />
      )}

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
