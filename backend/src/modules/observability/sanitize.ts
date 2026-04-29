const MAX_STRING = 240;

export function truncate(
  s: string | undefined,
  max = MAX_STRING,
): string | undefined {
  if (s == null) return undefined;
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

export function redactContent(s: string): string {
  return truncate(s, MAX_STRING) ?? '';
}

export function summarize(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string') {
      out[k] = truncate(v, MAX_STRING);
    } else if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = `array(len=${v.length})`;
    } else if (typeof v === 'object') {
      out[k] = `object(keys=${Object.keys(v).length})`;
    }
  }
  return out;
}
