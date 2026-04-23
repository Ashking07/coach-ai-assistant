import { ConfidenceTier } from '@prisma/client';
import { validateDraft } from './validate-draft.state';
import type { AvailableSlot } from './load-context.state';

const SLOT: AvailableSlot = {
  startAt: new Date('2026-04-24T16:00:00Z'),
  endAt: new Date('2026-04-24T17:00:00Z'),
  label: 'Thursday Apr 24, 9:00–10:00 AM',
};

describe('validateDraft', () => {
  it('returns unchanged tier when intent is not BOOK', () => {
    const result = validateDraft({
      draft: 'See you at Friday 2:00 PM',
      availableSlots: [],
      tier: ConfidenceTier.AUTO,
      intent: 'QUESTION_LOGISTICS',
    });
    expect(result).toEqual({ tier: ConfidenceTier.AUTO, downgraded: false });
  });

  it('passes when draft has no time tokens', () => {
    const result = validateDraft({
      draft: "I'll check with the coach and get back to you.",
      availableSlots: [SLOT],
      tier: ConfidenceTier.AUTO,
      intent: 'BOOK',
    });
    expect(result).toEqual({ tier: ConfidenceTier.AUTO, downgraded: false });
  });

  it('passes when day token matches a slot label', () => {
    const result = validateDraft({
      draft: 'Hi! I have Thursday available — does that work?',
      availableSlots: [SLOT],
      tier: ConfidenceTier.AUTO,
      intent: 'BOOK',
    });
    expect(result).toEqual({ tier: ConfidenceTier.AUTO, downgraded: false });
  });

  it('passes when time token matches a slot label', () => {
    const result = validateDraft({
      draft: 'Hi! Priya has a slot at 9:00 AM — does that work?',
      availableSlots: [SLOT],
      tier: ConfidenceTier.AUTO,
      intent: 'BOOK',
    });
    expect(result).toEqual({ tier: ConfidenceTier.AUTO, downgraded: false });
  });

  it('downgrades AUTO→APPROVE when draft mentions unlisted day', () => {
    const result = validateDraft({
      draft: 'Hi! I have Saturday at 10am — does that work?',
      availableSlots: [SLOT],
      tier: ConfidenceTier.AUTO,
      intent: 'BOOK',
    });
    expect(result.tier).toBe(ConfidenceTier.APPROVE);
    expect(result.downgraded).toBe(true);
    expect(result.reason).toMatch(/not in availableSlots/);
  });

  it('downgrades when draft mentions unlisted time', () => {
    const result = validateDraft({
      draft: 'I have a spot at 3:00 PM on Thursday',
      availableSlots: [SLOT],
      tier: ConfidenceTier.AUTO,
      intent: 'BOOK',
    });
    expect(result.tier).toBe(ConfidenceTier.APPROVE);
    expect(result.downgraded).toBe(true);
  });

  it('APPROVE tier stays APPROVE, downgraded=false (already at floor)', () => {
    const result = validateDraft({
      draft: 'Hi! I have Saturday at 2:00 PM',
      availableSlots: [],
      tier: ConfidenceTier.APPROVE,
      intent: 'BOOK',
    });
    expect(result.tier).toBe(ConfidenceTier.APPROVE);
    expect(result.downgraded).toBe(false);
  });
});
