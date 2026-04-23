import { T } from '../tokens';
import { IntentBadge } from './badges';
import type { Fire, Approval, DashboardSession } from '../lib/api';

// ─── FireCard ────────────────────────────────────────────────────────────────

export function FireCard({ fire, onOpen }: { fire: Fire; onOpen: () => void }) {
  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-2 cursor-pointer"
      style={{
        background: 'var(--panel)',
        border: `1px solid ${T.terracotta}44`,
      }}
      onClick={onOpen}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: T.terracotta }}
          />
          <span
            style={{
              color: 'var(--text)',
              fontSize: 14,
              fontFamily: 'Inter Tight, sans-serif',
              fontWeight: 500,
            }}
            className="truncate"
          >
            {fire.parent}
          </span>
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>· {fire.kid}</span>
        </div>
        <span
          style={{
            fontFamily: 'Geist Mono, monospace',
            fontSize: 11,
            color: 'var(--muted)',
            flexShrink: 0,
          }}
        >
          {fire.ago}
        </span>
      </div>
      <p
        className="text-sm leading-snug line-clamp-2"
        style={{ color: 'var(--muted)', fontStyle: 'italic' }}
      >
        "{fire.preview}"
      </p>
      <div>
        <IntentBadge intent={fire.intent} />
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
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ color: 'var(--text)', fontSize: 14, fontWeight: 500 }} className="truncate">
            {approval.parent}
          </span>
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>· {approval.kid}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <IntentBadge intent={approval.intent} />
          <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--muted)' }}>
            {approval.ago}
          </span>
        </div>
      </div>

      <div
        className="rounded-xl p-3 text-sm leading-snug"
        style={{ background: 'var(--surface-sub)', color: 'var(--muted)' }}
      >
        {approval.draft}
      </div>

      <div
        style={{
          fontFamily: 'Geist Mono, monospace',
          fontSize: 11,
          color: 'var(--muted)',
        }}
      >
        {Math.round(approval.confidence * 100)}% · {approval.reason}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onSend}
          className="flex-1 py-2 rounded-xl text-sm font-medium transition-opacity hover:opacity-80"
          style={{ background: T.sunrise, color: '#F7F3EC', border: 'none', cursor: 'pointer' }}
        >
          Send
        </button>
        <button
          onClick={onEdit}
          className="px-4 py-2 rounded-xl text-sm transition-opacity hover:opacity-80"
          style={{
            background: 'var(--surface-sub)',
            color: 'var(--text)',
            border: '1px solid var(--hairline)',
            cursor: 'pointer',
          }}
        >
          Edit
        </button>
      </div>
    </div>
  );
}

// ─── SessionCard ──────────────────────────────────────────────────────────────

export function SessionCard({
  session,
  onOpen,
}: {
  session: DashboardSession;
  onOpen: () => void;
}) {
  return (
    <div
      className="shrink-0 rounded-2xl p-4 flex flex-col gap-2 cursor-pointer"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--hairline)',
        minWidth: 160,
      }}
      onClick={onOpen}
    >
      <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12, color: 'var(--muted)' }}>
        {session.time} · {session.duration}
      </div>
      <div style={{ color: 'var(--text)', fontSize: 15, fontWeight: 500 }}>{session.kid}</div>
      <div
        className="text-xs leading-snug line-clamp-2"
        style={{ color: 'var(--muted)' }}
      >
        {session.note || 'No notes'}
      </div>
      <div
        style={{
          fontFamily: 'Geist Mono, monospace',
          fontSize: 10,
          color: session.paid ? T.moss : T.amber,
          letterSpacing: '0.06em',
        }}
      >
        {session.paid ? 'PAID' : 'UNPAID'}
      </div>
    </div>
  );
}
