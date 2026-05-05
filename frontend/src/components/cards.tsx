import { ChevronRight, Mic, Trash2, X } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { T } from '../tokens';
import { api } from '../lib/api';
import { IntentBadge, TierBadge } from './badges';
import { KidAvatar } from './avatar';
import type { Fire, Approval, DashboardSession, PaymentMethod } from '../lib/api';

// ─── FireCard ────────────────────────────────────────────────────────────────

export function FireCard({ fire, onOpen, onDismiss }: { fire: Fire; onOpen: () => void; onDismiss?: () => void }) {
  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-2 cursor-pointer transition-colors"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--hairline)',
        borderLeft: `3px solid ${T.terracotta}`,
      }}
      onClick={onOpen}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <KidAvatar name={fire.parent} size={34} />
          <div className="min-w-0">
            <div className="truncate" style={{ color: 'var(--text)', fontSize: 14, fontWeight: 500 }}>
              {fire.parent}
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>{fire.kid}</div>
          </div>
        </div>
        <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: T.terracotta, flexShrink: 0 }}>
          {fire.ago}
        </span>
      </div>

      <span
        className="self-start px-2 py-0.5 rounded"
        style={{
          fontSize: 11,
          fontFamily: 'Geist Mono, monospace',
          color: T.terracotta,
          background: T.terracotta + '18',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        <IntentBadge intent={fire.intent} />
      </span>

      <p style={{ color: 'var(--text)', fontSize: 14, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{fire.preview}</p>

      <div className="flex gap-2 mt-1">
        <button
          className="flex-1 py-2.5 rounded-xl transition-opacity hover:opacity-90"
          style={{ background: T.terracotta, color: '#F7F3EC', fontSize: 14, border: 'none', cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
        >
          Open
        </button>
        <button
          className="px-4 py-2.5 rounded-xl"
          style={{
            background: 'transparent',
            color: 'var(--muted)',
            border: '1px solid var(--hairline)',
            fontSize: 14,
            cursor: 'pointer',
          }}
          onClick={(e) => { e.stopPropagation(); onDismiss?.(); }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ─── ApprovalCard ─────────────────────────────────────────────────────────────

export function ApprovalCard({
  approval,
  onSend,
  onEdit,
}: {
  approval: Approval;
  onSend: () => void;
  onEdit: () => void;
}) {
  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-3"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--hairline)',
        borderLeft: `3px solid ${T.amber}`,
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <KidAvatar name={approval.parent} size={34} />
        <div className="min-w-0">
          <div style={{ color: 'var(--text)', fontSize: 14 }}>
            {approval.parent} <span style={{ color: 'var(--muted)' }}>· {approval.kid}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span style={{ color: T.amber }}><IntentBadge intent={approval.intent} /></span>
            <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--muted)' }}>
              {approval.ago}
            </span>
          </div>
        </div>
      </div>

      <div
        className="rounded-xl p-3"
        style={{ background: 'var(--surface-sub)', border: '1px solid var(--hairline)' }}
      >
        <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 6 }}>Parent</div>
        <p style={{ color: 'var(--text)', fontSize: 14 }}>{approval.incoming}</p>
      </div>

      <div
        className="rounded-xl p-3"
        style={{ background: T.amber + '10', border: `1px solid ${T.amber}30` }}
      >
        <div style={{ color: T.amber, fontSize: 11, fontFamily: 'Geist Mono, monospace', letterSpacing: '0.08em', marginBottom: 6 }}>
          AGENT DRAFT
        </div>
        <p style={{ color: 'var(--text)', fontSize: 14, lineHeight: 1.55 }}>{approval.draft}</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: 11, fontFamily: 'Geist Mono, monospace', color: 'var(--muted)' }}>
        <TierBadge tier="APPROVE" />
        <span>· {Math.round(approval.confidence * 100)}%</span>
        {approval.reason && <span>· {approval.reason}</span>}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onSend}
          className="flex-1 py-2.5 rounded-xl transition-opacity hover:opacity-90"
          style={{ background: T.sunrise, color: '#F7F3EC', fontSize: 14, border: 'none', cursor: 'pointer' }}
        >
          Send
        </button>
        <button
          onClick={onEdit}
          className="px-5 py-2.5 rounded-xl"
          style={{ color: 'var(--text)', border: '1px solid var(--hairline)', fontSize: 14, background: 'transparent', cursor: 'pointer' }}
        >
          Edit
        </button>
      </div>
    </div>
  );
}

// ─── SessionCard ──────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { useRecapRecorder } from '../lib/voice/use-recap-recorder';
import { RecapRecorderOverlay } from './recap/recap-recorder-overlay';

export function SessionCard({
  session,
  onOpen,
  onDelete,
  stripeConnected,
}: {
  session: DashboardSession;
  onOpen: () => void;
  onDelete?: (id: string) => void;
  stripeConnected?: boolean;
}) {
  const queryClient = useQueryClient();
  const recap = useRecapRecorder(session.id);
  const [showOverlay, setShowOverlay] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showMarkPaid, setShowMarkPaid] = useState(false);
  const [paidMethod, setPaidMethod] = useState<PaymentMethod>('CASH');
  const [paidNotes, setPaidNotes] = useState('');

  const handleMicClick = () => {
    setShowOverlay(true);
    recap.startRecording();
  };

  const handleDeleteClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (!onDelete) return;
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = () => {
    setShowDeleteConfirm(false);
    onDelete?.(session.id);
  };

  const handleOverlayClose = () => {
    if (recap.state !== 'processing') {
      setShowOverlay(false);
    }
  };

  const markPaidMutation = useMutation({
    mutationFn: () => api.markSessionPaid(session.id, { method: paidMethod, notes: paidNotes || undefined }),
    onSuccess: () => {
      setShowMarkPaid(false);
      setPaidNotes('');
      void queryClient.invalidateQueries({ queryKey: ['home'] });
      void queryClient.invalidateQueries({ queryKey: ['week-sessions'] });
    },
  });

  const [paymentLinkSent, setPaymentLinkSent] = useState(false);
  const sendPaymentLinkMutation = useMutation({
    mutationFn: () => api.sendPaymentLink(session.id),
    onSuccess: () => {
      setPaymentLinkSent(true);
      setTimeout(() => setPaymentLinkSent(false), 4000);
    },
  });

  const isPast = (() => {
    const [hh, mm] = session.time.split(':').map((v) => Number(v));
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return false;
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    return d.getTime() < Date.now();
  })();

  useEffect(() => {
    if (recap.state === 'done') {
      const t = setTimeout(() => setShowOverlay(false), 2000);
      return () => clearTimeout(t);
    }
  }, [recap.state]);

  return (
    <>
      <div
        className="shrink-0 rounded-2xl p-4 flex flex-col gap-2"
        style={{ background: 'var(--panel)', border: '1px solid var(--hairline)', width: 220 }}
      >
        <div className="flex items-center justify-between">
          <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12, color: 'var(--muted)' }}>
            {session.time} · {session.duration}
          </span>
          {!session.paid && (
            <span style={{ fontSize: 10, fontFamily: 'Geist Mono, monospace', color: T.amber, letterSpacing: '0.08em' }}>
              UNPAID
            </span>
          )}
          {session.paid && (
            <span style={{ fontSize: 10, fontFamily: 'Geist Mono, monospace', color: T.moss, letterSpacing: '0.08em' }}>
              PAID{session.paymentMethod ? ` · ${session.paymentMethod}` : ''}
            </span>
          )}
        </div>
        <div style={{ color: 'var(--text)', fontSize: 17, fontWeight: 500 }}>{session.kid}</div>
        <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.45 }}>{session.note || 'No notes'}</div>
        <div className="flex items-center justify-between mt-2">
          <div
            className="flex items-center gap-1 cursor-pointer"
            onClick={onOpen}
            style={{ color: 'var(--muted)', fontSize: 12 }}
          >
            Open <ChevronRight size={14} />
          </div>
          <div className="flex items-center gap-1">
            {!session.paid && session.priceCents > 0 && (
              <button
                onClick={() => stripeConnected && sendPaymentLinkMutation.mutate()}
                disabled={!stripeConnected || sendPaymentLinkMutation.isPending || paymentLinkSent}
                className="px-2 py-1 rounded-lg transition-colors"
                style={{
                  background: !stripeConnected ? 'var(--hairline)' : T.sunrise + '18',
                  color: !stripeConnected ? 'var(--muted)' : paymentLinkSent ? T.moss : T.sunrise,
                  border: `1px solid ${!stripeConnected ? 'var(--hairline)' : paymentLinkSent ? T.moss + '55' : T.sunrise + '55'}`,
                  fontSize: 11,
                  cursor: stripeConnected ? 'pointer' : 'default',
                  opacity: !stripeConnected ? 0.55 : 1,
                }}
                title={!stripeConnected ? 'Connect Stripe in Settings first' : 'Send Stripe payment link'}
              >
                {paymentLinkSent ? 'Link sent ✓' : sendPaymentLinkMutation.isPending ? 'Sending…' : 'Send link'}
              </button>
            )}
            {!session.paid && isPast && (
              <button
                onClick={() => setShowMarkPaid(true)}
                className="px-2 py-1 rounded-lg transition-colors"
                style={{
                  background: T.moss + '18',
                  color: T.moss,
                  border: `1px solid ${T.moss}55`,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
                title="Mark paid"
              >
                Mark paid
              </button>
            )}
            {onDelete && (
              <button
                onClick={handleDeleteClick}
                className="p-1.5 rounded-lg transition-colors"
                style={{
                  background: 'transparent',
                  color: 'var(--muted)',
                  border: '1px solid transparent',
                  cursor: 'pointer',
                }}
                title="Cancel session"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button
              onClick={handleMicClick}
              className="p-1.5 rounded-lg transition-colors"
              style={{
                background: 'transparent',
                color: 'var(--muted)',
                border: '1px solid transparent',
                cursor: 'pointer',
              }}
              title="Record session recap"
            >
              <Mic size={16} />
            </button>
          </div>
        </div>
      </div>
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 flex items-center justify-center p-4 md:p-8"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', zIndex: 80 }}
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative flex flex-col w-full rounded-3xl overflow-hidden"
            style={{
              background: '#0E0F0C',
              border: '1px solid #2A2B27',
              maxWidth: 420,
              boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
            }}
          >
            <div
              className="sticky top-0 flex items-center justify-between px-5 py-4"
              style={{ background: 'rgba(14,15,12,0.92)', backdropFilter: 'blur(20px)', borderBottom: '1px solid #2A2B27' }}
            >
              <span
                style={{
                  fontFamily: 'Geist Mono, monospace',
                  fontSize: 11,
                  letterSpacing: '0.1em',
                  color: '#A8A49B',
                  textTransform: 'uppercase',
                }}
              >
                Cancel session
              </span>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="p-2 -mr-2 rounded-full"
                style={{ color: '#A8A49B', background: 'none', border: 'none', cursor: 'pointer' }}
                aria-label="Close confirmation"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-5 md:px-6 py-6 flex flex-col gap-4">
              <div style={{ color: '#F7F3EC', fontSize: 20, fontWeight: 500 }}>Cancel this session?</div>
              <div style={{ color: '#D4D0C7', fontSize: 14, lineHeight: 1.55 }}>
                This will cancel {session.kid}'s {session.time} session and remove it from the week view.
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-3 rounded-2xl"
                  style={{ background: 'transparent', border: '1px solid #2A2B27', color: '#F7F3EC', cursor: 'pointer' }}
                >
                  Keep session
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  className="flex-1 py-3 rounded-2xl"
                  style={{ background: '#C2410C', border: 'none', color: '#F7F3EC', cursor: 'pointer' }}
                >
                  Cancel session
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showMarkPaid && (
        <div
          className="fixed inset-0 flex items-center justify-center p-4 md:p-8"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', zIndex: 80 }}
          onClick={() => setShowMarkPaid(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative flex flex-col w-full rounded-3xl overflow-hidden"
            style={{
              background: '#0E0F0C',
              border: '1px solid #2A2B27',
              maxWidth: 420,
              boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
            }}
          >
            <div
              className="sticky top-0 flex items-center justify-between px-5 py-4"
              style={{ background: 'rgba(14,15,12,0.92)', backdropFilter: 'blur(20px)', borderBottom: '1px solid #2A2B27' }}
            >
              <span
                style={{
                  fontFamily: 'Geist Mono, monospace',
                  fontSize: 11,
                  letterSpacing: '0.1em',
                  color: '#A8A49B',
                  textTransform: 'uppercase',
                }}
              >
                Mark paid
              </span>
              <button
                onClick={() => setShowMarkPaid(false)}
                className="p-2 -mr-2 rounded-full"
                style={{ color: '#A8A49B', background: 'none', border: 'none', cursor: 'pointer' }}
                aria-label="Close mark paid"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-5 md:px-6 py-6 flex flex-col gap-4">
              <div style={{ color: '#F7F3EC', fontSize: 18, fontWeight: 500 }}>Payment method</div>
              <div className="flex flex-wrap gap-2">
                {(['CASH', 'VENMO', 'ZELLE', 'CHECK', 'OTHER'] as PaymentMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPaidMethod(m)}
                    className="px-3 py-2 rounded-xl"
                    style={{
                      background: paidMethod === m ? T.sunrise + '22' : 'transparent',
                      border: `1px solid ${paidMethod === m ? T.sunrise : '#2A2B27'}`,
                      color: paidMethod === m ? T.sunrise : '#F7F3EC',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <label className="flex flex-col gap-2">
                <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 10, letterSpacing: '0.1em', color: '#A8A49B', textTransform: 'uppercase' }}>
                  Notes (optional)
                </span>
                <input
                  value={paidNotes}
                  onChange={(e) => setPaidNotes(e.target.value)}
                  className="rounded-xl px-3 py-2"
                  style={{ background: '#12130F', border: '1px solid #2A2B27', color: '#F7F3EC' }}
                />
              </label>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowMarkPaid(false)}
                  className="flex-1 py-3 rounded-2xl"
                  style={{ background: 'transparent', border: '1px solid #2A2B27', color: '#F7F3EC', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => markPaidMutation.mutate()}
                  disabled={markPaidMutation.isPending}
                  className="flex-1 py-3 rounded-2xl"
                  style={{ background: T.sunrise, border: 'none', color: '#F7F3EC', cursor: 'pointer' }}
                >
                  {markPaidMutation.isPending ? 'Saving…' : 'Mark paid'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showOverlay && (
        <RecapRecorderOverlay
          state={recap.state}
          transcript={recap.transcript}
          error={recap.error}
          onStop={recap.stopRecording}
          onClose={handleOverlayClose}
        />
      )}
    </>
  );
}
