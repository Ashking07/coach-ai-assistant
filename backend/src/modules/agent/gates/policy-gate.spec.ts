import { PolicyGate } from './policy-gate';

describe('PolicyGate', () => {
  const gate = new PolicyGate();

  it('returns ESCALATE for unknown sender regardless of intent', () => {
    const result = gate.check({
      intent: 'BOOK',
      parentKnown: false,
      content: 'Book Priya Thursday',
    });
    expect(result).toEqual({ tier: 'ESCALATE', reason: 'Unknown sender' });
  });

  it('returns ESCALATE for PAYMENT intent', () => {
    const result = gate.check({
      intent: 'PAYMENT',
      parentKnown: true,
      content: 'When is my invoice due?',
    });
    expect(result).toEqual({
      tier: 'ESCALATE',
      reason: 'Intent requires coach review',
    });
  });

  it('returns ESCALATE for COMPLAINT intent', () => {
    const result = gate.check({
      intent: 'COMPLAINT',
      parentKnown: true,
      content: "I'm not happy with the sessions",
    });
    expect(result).toEqual({
      tier: 'ESCALATE',
      reason: 'Intent requires coach review',
    });
  });

  it('returns ESCALATE for AMBIGUOUS intent', () => {
    const result = gate.check({
      intent: 'AMBIGUOUS',
      parentKnown: true,
      content: 'umm',
    });
    expect(result).toEqual({
      tier: 'ESCALATE',
      reason: 'Intent requires coach review',
    });
  });

  it('returns ESCALATE for OUT_OF_SCOPE intent', () => {
    const result = gate.check({
      intent: 'OUT_OF_SCOPE',
      parentKnown: true,
      content: 'What is the capital of France?',
    });
    expect(result).toEqual({
      tier: 'ESCALATE',
      reason: 'Intent requires coach review',
    });
  });

  it('returns ESCALATE for sensitive keyword regardless of intent (classifier mis-label backstop)', () => {
    const result = gate.check({
      intent: 'QUESTION_LOGISTICS',
      parentKnown: true,
      content: "What's the refund policy?",
    });
    expect(result).toEqual({
      tier: 'ESCALATE',
      reason: 'Sensitive keyword detected',
    });
  });

  it('returns ESCALATE for "discount" keyword', () => {
    const result = gate.check({
      intent: 'BOOK',
      parentKnown: true,
      content: 'Can we book and also get a discount?',
    });
    expect(result).toEqual({
      tier: 'ESCALATE',
      reason: 'Sensitive keyword detected',
    });
  });

  it('returns ESCALATE for "injury" keyword', () => {
    const result = gate.check({
      intent: 'QUESTION_PROGRESS',
      parentKnown: true,
      content: 'Priya has a knee injury',
    });
    expect(result).toEqual({
      tier: 'ESCALATE',
      reason: 'Sensitive keyword detected',
    });
  });

  it('returns null for clean BOOK message from known parent', () => {
    const result = gate.check({
      intent: 'BOOK',
      parentKnown: true,
      content: 'Can we book Priya for Thursday at 9am?',
    });
    expect(result).toBeNull();
  });

  it('returns null for QUESTION_LOGISTICS with no sensitive keywords', () => {
    const result = gate.check({
      intent: 'QUESTION_LOGISTICS',
      parentKnown: true,
      content: 'What time is the session tomorrow?',
    });
    expect(result).toBeNull();
  });
});
