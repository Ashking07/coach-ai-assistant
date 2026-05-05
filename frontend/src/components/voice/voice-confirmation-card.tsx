import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type StoredVoiceProposal } from '../../lib/api';

function describe(p: StoredVoiceProposal['proposal']): { title: string; body: string } {
  switch (p.kind) {
    case 'APPROVE_PENDING':
      return { title: 'Approve pending reply', body: p.summary };
    case 'DISMISS_PENDING':
      return { title: 'Dismiss pending reply', body: p.summary };
    case 'DRAFT_REPLY':
      return { title: `Reply to ${p.parentName}`, body: p.messageBody };
    case 'BLOCK_AVAILABILITY':
      return {
        title: 'Block availability',
        body: `${new Date(p.startAtIso).toLocaleString()} → ${new Date(p.endAtIso).toLocaleString()}`,
      };
    case 'CANCEL_SESSION':
      return { title: 'Cancel session', body: p.summary };
    case 'SCHEDULE_SESSION':
      return {
        title: `Schedule ${p.kidName}`,
        body: `${new Date(p.startAtIso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · 60 min`,
      };
    case 'ADD_AVAILABILITY':
      return {
        title: 'Add available slot',
        body: `${new Date(p.startAtIso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} → ${new Date(p.endAtIso).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
      };
  }
}

export function VoiceConfirmationCard({
  stored,
  onClose,
}: {
  stored: StoredVoiceProposal;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const confirm = useMutation({
    mutationFn: () => api.voice.confirmProposal(stored.id),
    onSuccess: () => {
      void qc.invalidateQueries();
      onClose();
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.voice.cancelProposal(stored.id),
    onSuccess: onClose,
  });

  const { title, body } = describe(stored.proposal);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(6px)',
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0E0F0C',
          border: '1px solid #2A2B27',
          borderRadius: 24,
          padding: 24,
          maxWidth: 480,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div
          style={{
            fontFamily: 'Geist Mono, monospace',
            fontSize: 11,
            letterSpacing: '0.1em',
            color: '#A8A49B',
            textTransform: 'uppercase',
          }}
        >
          Confirm voice command
        </div>
        <div style={{ fontFamily: 'Fraunces, serif', fontSize: 22, color: '#F7F3EC' }}>{title}</div>
        <div style={{ fontFamily: 'Inter Tight, sans-serif', fontSize: 15, color: '#D4D0C7', whiteSpace: 'pre-wrap' }}>{body}</div>
        {confirm.error && (
          <div style={{ fontSize: 13, color: '#E8896A', background: '#E8896A18', border: '1px solid #E8896A30', borderRadius: 10, padding: '8px 12px' }}>
            {confirm.error.message}
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button
            onClick={() => cancel.mutate()}
            disabled={cancel.isPending || confirm.isPending}
            style={{
              flex: 1,
              padding: '12px 16px',
              background: 'transparent',
              border: '1px solid #2A2B27',
              color: '#F7F3EC',
              borderRadius: 12,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => confirm.mutate()}
            disabled={confirm.isPending || cancel.isPending}
            style={{
              flex: 1,
              padding: '12px 16px',
              background: '#C2410C',
              border: 'none',
              color: '#F7F3EC',
              borderRadius: 12,
              cursor: 'pointer',
            }}
          >
            {confirm.isPending ? 'Confirming…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
