import { redactContent, truncate, summarize } from './sanitize';

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('hi', 10)).toBe('hi');
  });
  it('truncates long strings with an ellipsis suffix', () => {
    expect(truncate('a'.repeat(50), 10)).toBe('aaaaaaaaaa…');
  });
  it('handles undefined', () => {
    expect(truncate(undefined, 10)).toBeUndefined();
  });
});

describe('redactContent', () => {
  it('truncates long content to 240 chars', () => {
    const s = 'a'.repeat(1000);
    expect(redactContent(s)).toHaveLength(241); // 240 + ellipsis
  });
  it('preserves short content as-is', () => {
    expect(redactContent('Book Priya Thursday 4pm')).toBe(
      'Book Priya Thursday 4pm',
    );
  });
});

describe('summarize', () => {
  it('drops large fields and keeps small ones', () => {
    const out = summarize({
      tokensIn: 100,
      tokensOut: 20,
      bigBlob: 'x'.repeat(5000),
      shortLabel: 'BOOK',
    });
    expect(out.tokensIn).toBe(100);
    expect(out.shortLabel).toBe('BOOK');
    expect(out.bigBlob).toMatch(/…$/);
  });
});
