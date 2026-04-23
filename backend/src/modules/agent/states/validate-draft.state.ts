import { ConfidenceTier, type Intent } from '@prisma/client';
import type { AvailableSlot } from './load-context.state';

export type ValidateDraftInput = {
  draft: string;
  availableSlots: AvailableSlot[];
  tier: ConfidenceTier;
  intent: Intent;
};

export type ValidateDraftResult = {
  tier: ConfidenceTier;
  downgraded: boolean;
  reason?: string;
};

const TIME_RE = /\b\d{1,2}:\d{2}\s?(?:AM|PM|am|pm)\b/g;
const DAY_RE =
  /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/g;

export function validateDraft(input: ValidateDraftInput): ValidateDraftResult {
  if (input.intent !== 'BOOK') {
    return { tier: input.tier, downgraded: false };
  }

  const times = [...(input.draft.match(TIME_RE) ?? [])];
  const days = [...(input.draft.match(DAY_RE) ?? [])];
  const tokens = [...times, ...days];

  if (tokens.length === 0) {
    return { tier: input.tier, downgraded: false };
  }

  const allLabels = input.availableSlots.map((s) => s.label);

  // Strip AM/PM from time tokens before substring check because the label format
  // is "9:00–10:00 AM" — "9:00 AM" won't match as a substring, but "9:00" will.
  const normalize = (token: string) =>
    token.replace(/\s?(?:AM|PM|am|pm)\b/, '').trim();

  for (const token of tokens) {
    const normalized = normalize(token);
    if (!allLabels.some((label) => label.includes(normalized))) {
      return {
        tier: ConfidenceTier.APPROVE,
        downgraded: input.tier !== ConfidenceTier.APPROVE,
        reason: 'Draft referenced time not in availableSlots',
      };
    }
  }

  return { tier: input.tier, downgraded: false };
}
