import { ChevronRight, Mic } from 'lucide-react';
import { T } from '../tokens';
import { IntentBadge, TierBadge } from './badges';
import { KidAvatar } from './avatar';
import type { Fire, Approval, DashboardSession } from '../lib/api';

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

      <p style={{ color: 'var(--text)', fontSize: 14, lineHeight: 1.5 }}>{fire.preview}</p>

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

export function SessionCard({ session, onOpen }: { session: DashboardSession; onOpen: () => void }) {
  const recap = useRecapRecorder(session.id);
  const [showOverlay, setShowOverlay] = useState(false);

  const handleMicClick = () => {
    setShowOverlay(true);
    recap.startRecording();
  };

  const handleOverlayClose = () => {
    if (recap.state !== 'processing') {
      setShowOverlay(false);
    }
  };

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
