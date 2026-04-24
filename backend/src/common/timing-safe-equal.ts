import { timingSafeEqual } from 'node:crypto';

export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // timingSafeEqual requires equal-length buffers. Length leakage for
    // secrets of a fixed expected size is acceptable here.
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
