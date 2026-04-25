import { Injectable } from '@nestjs/common';
import { ConfidenceTier, type Intent } from '@prisma/client';

export type ConfidenceGateInput = {
  intent: Intent;
  confidence: number;
  parentKnown: boolean;
  hasAvailableSlots: boolean;
};

@Injectable()
export class ConfidenceGate {
  determine(input: ConfidenceGateInput): ConfidenceTier {
    const { intent, confidence, parentKnown, hasAvailableSlots } = input;

    if (
      intent === 'BOOK' &&
      parentKnown &&
      confidence >= 0.8 &&
      hasAvailableSlots
    ) {
      return ConfidenceTier.AUTO;
    }
    if (intent === 'BOOK') {
      return ConfidenceTier.APPROVE;
    }
    if (intent === 'QUESTION_LOGISTICS' && parentKnown && confidence >= 0.7) {
      return ConfidenceTier.AUTO;
    }
    if (intent === 'SMALLTALK' && parentKnown && confidence >= 0.6) {
      return ConfidenceTier.AUTO;
    }
    // RESCHEDULE, CANCEL, QUESTION_PROGRESS, and fallback → APPROVE
    return ConfidenceTier.APPROVE;
  }
}
