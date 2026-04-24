import { timingSafeEqualStr } from './timing-safe-equal';

describe('timingSafeEqualStr', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqualStr('abc123', 'abc123')).toBe(true);
  });

  it('returns false for different strings of same length', () => {
    expect(timingSafeEqualStr('abc123', 'abc124')).toBe(false);
  });

  it('returns false for strings of different lengths (no throw)', () => {
    expect(timingSafeEqualStr('short', 'longer-string')).toBe(false);
  });

  it('returns false when one side is empty', () => {
    expect(timingSafeEqualStr('', 'something')).toBe(false);
    expect(timingSafeEqualStr('something', '')).toBe(false);
  });

  it('returns true for two empty strings', () => {
    expect(timingSafeEqualStr('', '')).toBe(true);
  });
});
