import { useState } from 'react';
import { X } from 'lucide-react';
import { T } from '../tokens';
import { IntentBadge } from './badges';
import type { Approval } from '../lib/api';

export function ApprovalDetail({
  approval,
  onClose,
  onSend,
  onDismiss,
}: {
  approval: Approval;
  onClose: () => void;
  onSend: (draft: string) => void;
  onDismiss: () => void;
}) {
  const [draft, setDraft] = useState(approval.draft);

  return (
    <div
      className="fixed inset-0 overflow-y-auto"
      style={{ background: 'var(--bg)', zIndex: 50 }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 sticky top-0"
        style={{
          background: 'var(--panel-solid)',
          borderBottom: '1px solid var(--hairline)',
        }}
      >
        <div style={{ color: 'var(--text)', fontSize: 15, fontWeight: 500 }}>
          Draft reply
        </div>
        <button
          onClick={onClose}
          style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
        >
          <X size={20} />
        </button>
      </div>

      <div className="px-4 py-6 md:px-8 flex flex-col gap-5 pb-40">
        {/* Parent info */}
        <div>
          <h1
            style={{
              fontFamily: 'Fraunces, serif',
              fontWeight: 500,
              fontSize: 26,
              color: 'var(--text)',
              margin: 0,
            }}
          >
            {approval.parent}
          </h1>
          <div
            style={{
              fontFamily: 'Geist Mono, monospace',
              fontSize: 12,
              color: 'var(--muted)',
              marginTop: 4,
              display: 'flex',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <IntentBadge intent={approval.intent} />
            <span>·</span>
            <span>{Math.round(approval.confidence * 100)}% confidence</span>
            <span>·</span>
            <span>{approval.ago}</span>
          </div>
        </div>

        {/* Incoming */}
        <Field label="INCOMING">{approval.incoming}</Field>

        {/* Editable draft */}
        <div>
          <FieldLabel>DRAFT — edit before sending</FieldLabel>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            style={{
              width: '100%',
              background: T.amber + '0C',
              border: `1px solid ${T.amber}40`,
              borderRadius: 12,
              padding: '12px 14px',
              color: 'var(--text)',
              fontSize: 14,
              lineHeight: 1.55,
              resize: 'vertical',
              outline: 'none',
              fontFamily: 'Inter Tight, system-ui, sans-serif',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Reason */}
        {approval.reason && (
          <div>
            <FieldLabel>REASON</FieldLabel>
            <div
              style={{
                fontFamily: 'Geist Mono, monospace',
                fontSize: 12,
                color: 'var(--muted)',
                marginTop: 6,
              }}
            >
              {approval.reason}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div
        className="fixed bottom-0 left-0 right-0 px-4 md:px-8 flex gap-3 py-4"
        style={{
          background: 'linear-gradient(to top, var(--bg) 60%, transparent)',
          paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
        }}
      >
        <button
          onClick={onDismiss}
          className="flex-1 py-3 rounded-2xl text-sm transition-opacity hover:opacity-70"
          style={{
            background: 'var(--surface-sub)',
            color: 'var(--text)',
            border: '1px solid var(--hairline)',
            cursor: 'pointer',
          }}
        >
          Dismiss
        </button>
        <button
          onClick={() => onSend(draft)}
          disabled={!draft.trim()}
          className="flex-1 py-3 rounded-2xl text-sm font-medium transition-opacity hover:opacity-80"
          style={{
            background: draft.trim() ? T.sunrise : 'var(--surface-sub)',
            color: draft.trim() ? '#F7F3EC' : 'var(--muted)',
            border: 'none',
            cursor: draft.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          Send reply
        </button>
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        color: 'var(--muted)',
        fontSize: 10,
        fontFamily: 'Geist Mono, monospace',
        letterSpacing: '0.08em',
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div
        className="rounded-xl p-3"
        style={{
          background: 'var(--surface-sub)',
          color: 'var(--text)',
          fontSize: 14,
          border: '1px solid var(--hairline)',
          lineHeight: 1.5,
        }}
      >
        {children}
      </div>
    </div>
  );
}
