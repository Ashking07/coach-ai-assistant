import { ConfidenceGate } from './confidence-gate';

describe('ConfidenceGate', () => {
  const gate = new ConfidenceGate();

  it('BOOK + known parent + high confidence + has slots → AUTO', () => {
    expect(
      gate.determine({
        intent: 'BOOK',
        confidence: 0.9,
        parentKnown: true,
        hasAvailableSlots: true,
      }),
    ).toBe('AUTO');
  });

  it('BOOK + known parent + confidence below threshold → APPROVE', () => {
    expect(
      gate.determine({
        intent: 'BOOK',
        confidence: 0.7,
        parentKnown: true,
        hasAvailableSlots: true,
      }),
    ).toBe('APPROVE');
  });

  it('BOOK + known parent + high confidence + no slots → APPROVE', () => {
    expect(
      gate.determine({
        intent: 'BOOK',
        confidence: 0.95,
        parentKnown: true,
        hasAvailableSlots: false,
      }),
    ).toBe('APPROVE');
  });

  it('BOOK + unknown parent → APPROVE (PolicyGate handles escalation)', () => {
    expect(
      gate.determine({
        intent: 'BOOK',
        confidence: 0.95,
        parentKnown: false,
        hasAvailableSlots: true,
      }),
    ).toBe('APPROVE');
  });

  it('QUESTION_LOGISTICS + known parent + high confidence → AUTO', () => {
    expect(
      gate.determine({
        intent: 'QUESTION_LOGISTICS',
        confidence: 0.85,
        parentKnown: true,
        hasAvailableSlots: false,
      }),
    ).toBe('AUTO');
  });

  it('QUESTION_LOGISTICS + low confidence → APPROVE', () => {
    expect(
      gate.determine({
        intent: 'QUESTION_LOGISTICS',
        confidence: 0.6,
        parentKnown: true,
        hasAvailableSlots: false,
      }),
    ).toBe('APPROVE');
  });

  it('RESCHEDULE → APPROVE always', () => {
    expect(
      gate.determine({
        intent: 'RESCHEDULE',
        confidence: 0.99,
        parentKnown: true,
        hasAvailableSlots: true,
      }),
    ).toBe('APPROVE');
  });

  it('CANCEL → APPROVE always', () => {
    expect(
      gate.determine({
        intent: 'CANCEL',
        confidence: 0.99,
        parentKnown: true,
        hasAvailableSlots: false,
      }),
    ).toBe('APPROVE');
  });

  it('QUESTION_PROGRESS → APPROVE always', () => {
    expect(
      gate.determine({
        intent: 'QUESTION_PROGRESS',
        confidence: 0.99,
        parentKnown: true,
        hasAvailableSlots: false,
      }),
    ).toBe('APPROVE');
  });

  it('SMALLTALK → APPROVE always (Day 5 conservative)', () => {
    expect(
      gate.determine({
        intent: 'SMALLTALK',
        confidence: 0.99,
        parentKnown: true,
        hasAvailableSlots: false,
      }),
    ).toBe('APPROVE');
  });
});
