import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type DemoTokenPayload = {
  parentId: string;
  iat: number;
  exp: number;
};

export type IssuedDemoToken = {
  token: string;
  expiresAt: Date;
};

@Injectable()
export class DemoTokenService {
  private readonly ttlSeconds = 15 * 60;

  constructor(private readonly config: ConfigService) {}

  issueParentToken(parentId: string): IssuedDemoToken {
    const now = Math.floor(Date.now() / 1000);
    const payload: DemoTokenPayload = {
      parentId,
      iat: now,
      exp: now + this.ttlSeconds,
    };

    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      'base64url',
    );
    const signature = this.sign(encodedPayload);

    return {
      token: `${encodedPayload}.${signature}`,
      expiresAt: new Date(payload.exp * 1000),
    };
  }

  verifyParentToken(token: string): DemoTokenPayload | null {
    const [encodedPayload, providedSignature] = token.split('.');
    if (!encodedPayload || !providedSignature) {
      return null;
    }

    const expectedSignature = this.sign(encodedPayload);
    if (!this.safeEqual(providedSignature, expectedSignature)) {
      return null;
    }

    try {
      const parsed = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as DemoTokenPayload;

      if (!parsed.parentId || typeof parsed.parentId !== 'string') {
        return null;
      }

      if (!parsed.iat || !parsed.exp || parsed.exp <= parsed.iat) {
        return null;
      }

      if (parsed.exp <= Math.floor(Date.now() / 1000)) {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  private sign(encodedPayload: string): string {
    const secret = this.config.getOrThrow<string>('DEMO_TOKEN_SECRET');
    return createHmac('sha256', secret)
      .update(encodedPayload)
      .digest('base64url');
  }

  private safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) {
      return false;
    }
    return timingSafeEqual(left, right);
  }
}
