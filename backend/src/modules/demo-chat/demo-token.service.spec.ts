import { ConfigService } from '@nestjs/config';
import { DemoTokenService } from './demo-token.service';

describe('DemoTokenService', () => {
  const secret = 's'.repeat(40);
  let service: DemoTokenService;

  beforeEach(() => {
    service = new DemoTokenService({
      getOrThrow: (key: string) => {
        if (key === 'DEMO_TOKEN_SECRET') return secret;
        throw new Error(`unexpected key: ${key}`);
      },
    } as ConfigService);
  });

  it('issues and verifies a token bound to a parent for 15 minutes', () => {
    const issued = service.issueParentToken('parent-1');
    const payload = service.verifyParentToken(issued.token);

    expect(payload?.parentId).toBe('parent-1');
    expect(payload?.exp - payload!.iat).toBe(15 * 60);
    expect(issued.expiresAt.toISOString()).toBe(
      new Date(payload!.exp * 1000).toISOString(),
    );
  });

  it('rejects tampered token', () => {
    const issued = service.issueParentToken('parent-1');
    const tampered = `${issued.token}x`;

    expect(service.verifyParentToken(tampered)).toBeNull();
  });
});
