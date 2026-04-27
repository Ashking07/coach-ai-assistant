import { Injectable } from '@nestjs/common';
import { type Intent } from '@prisma/client';

export type PolicyCheckInput = {
  intent: Intent;
  parentKnown: boolean;
  content: string;
};

export type PolicyCheckResult = { tier: 'ESCALATE'; reason: string } | null;

// AMBIGUOUS is intentionally excluded — it goes to APPROVE tier so the coach
// can review a draft rather than receiving a cold escalation card.
const ESCALATE_INTENTS: Intent[] = [
  'PAYMENT',
  'COMPLAINT',
  'OUT_OF_SCOPE',
];

// Fires regardless of intent — backstop for classifier mis-labeling
const SENSITIVE_KEYWORD_RE =
  /\b(discount|refund|refunds|rate|rates|price|prices|fee|fees|medical|injury|hurt|lawsuit|complaint|complaints)\b/i;

@Injectable()
export class PolicyGate {
  check(input: PolicyCheckInput): PolicyCheckResult {
    if (!input.parentKnown) {
      return { tier: 'ESCALATE', reason: 'Unknown sender' };
    }
    if (SENSITIVE_KEYWORD_RE.test(input.content)) {
      return { tier: 'ESCALATE', reason: 'Sensitive keyword detected' };
    }
    if (ESCALATE_INTENTS.includes(input.intent)) {
      return { tier: 'ESCALATE', reason: 'Intent requires coach review' };
    }
    return null;
  }
}
