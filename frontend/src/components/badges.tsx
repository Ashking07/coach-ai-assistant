import { T } from '../tokens';

const INTENT_LABEL: Record<string, string> = {
  BOOK: 'Book',
  RESCHEDULE: 'Reschedule',
  CANCEL: 'Cancel',
  QUESTION_LOGISTICS: 'Logistics',
  QUESTION_PROGRESS: 'Progress',
  PAYMENT: 'Payment',
  SMALLTALK: 'Smalltalk',
  COMPLAINT: 'Complaint',
  AMBIGUOUS: 'Ambiguous',
  OUT_OF_SCOPE: 'OOS',
  NOT_PROCESSED: 'Unprocessed',
};

const INTENT_COLOR: Record<string, string> = {
  BOOK: T.moss,
  RESCHEDULE: T.amber,
  CANCEL: T.terracotta,
  QUESTION_LOGISTICS: T.moss,
  QUESTION_PROGRESS: T.moss,
  PAYMENT: T.sunrise,
  SMALLTALK: '#A8A49B',
  COMPLAINT: T.terracotta,
  AMBIGUOUS: '#A8A49B',
  OUT_OF_SCOPE: '#A8A49B',
  NOT_PROCESSED: '#A8A49B',
};

export function IntentBadge({ intent }: { intent: string }) {
  const color = INTENT_COLOR[intent] ?? '#A8A49B';
  const label = INTENT_LABEL[intent] ?? intent;
  return (
    <span
      style={{
        fontFamily: 'Geist Mono, monospace',
        fontSize: 10,
        color,
        letterSpacing: '0.06em',
      }}
    >
      {label.toUpperCase()}
    </span>
  );
}

const TIER_COLOR: Record<string, string> = {
  AUTO: T.moss,
  APPROVE: T.amber,
  ESCALATE: T.terracotta,
};

export function TierBadge({ tier }: { tier: string }) {
  const color = TIER_COLOR[tier] ?? '#A8A49B';
  return (
    <span
      style={{
        fontFamily: 'Geist Mono, monospace',
        fontSize: 10,
        color,
        background: color + '18',
        border: `1px solid ${color}44`,
        borderRadius: 4,
        padding: '1px 5px',
        letterSpacing: '0.05em',
      }}
    >
      {tier}
    </span>
  );
}
