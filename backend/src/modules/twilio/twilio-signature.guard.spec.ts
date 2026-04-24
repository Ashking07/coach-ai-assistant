import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import { validateRequest } from 'twilio';
import { TwilioSignatureGuard } from './twilio-signature.guard';

jest.mock('twilio', () => ({
  validateRequest: jest.fn(),
}));

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('TwilioSignatureGuard', () => {
  const validateRequestMock = validateRequest as jest.Mock;

  beforeEach(() => {
    validateRequestMock.mockReset();
  });

  it('allows bypass in non-production when verification is disabled', () => {
    const map: Record<string, string | boolean> = {
      NODE_ENV: 'development',
      TWILIO_WEBHOOK_VERIFY_DISABLED: true,
      TWILIO_AUTH_TOKEN: 'twilio-auth-token',
      PUBLIC_BASE_URL: 'https://example.com',
    };
    const guard = new TwilioSignatureGuard({
      get: (key: string) => map[key] as never,
      getOrThrow: (key: string) => {
        return map[key] as never;
      },
    } as ConfigService);

    const allowed = guard.canActivate(
      makeContext({ headers: {}, body: {}, originalUrl: '/api/twilio/inbound' }),
    );

    expect(allowed).toBe(true);
    expect(validateRequestMock).not.toHaveBeenCalled();
  });

  it('rejects when signature header is missing', () => {
    const map: Record<string, string | boolean> = {
      NODE_ENV: 'production',
      TWILIO_WEBHOOK_VERIFY_DISABLED: false,
      TWILIO_AUTH_TOKEN: 'twilio-auth-token',
      PUBLIC_BASE_URL: 'https://example.com',
    };
    const guard = new TwilioSignatureGuard({
      get: (key: string) => map[key] as never,
      getOrThrow: (key: string) => {
        return map[key] as never;
      },
    } as ConfigService);

    expect(() =>
      guard.canActivate(
        makeContext({ headers: {}, body: {}, originalUrl: '/api/twilio/inbound' }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('validates Twilio signature with configured base URL', () => {
    validateRequestMock.mockReturnValue(true);

    const map: Record<string, string | boolean> = {
      NODE_ENV: 'production',
      TWILIO_WEBHOOK_VERIFY_DISABLED: false,
      TWILIO_AUTH_TOKEN: 'twilio-auth-token',
      PUBLIC_BASE_URL: 'https://example.com',
    };
    const guard = new TwilioSignatureGuard({
      get: (key: string) => map[key] as never,
      getOrThrow: (key: string) => {
        return map[key] as never;
      },
    } as ConfigService);

    const allowed = guard.canActivate(
      makeContext({
        headers: { 'x-twilio-signature': 'sig' },
        body: { MessageSid: 'SM123', Body: 'hello' },
        originalUrl: '/api/twilio/inbound',
      }),
    );

    expect(allowed).toBe(true);
    expect(validateRequestMock).toHaveBeenCalledWith(
      'twilio-auth-token',
      'sig',
      'https://example.com/api/twilio/inbound',
      { MessageSid: 'SM123', Body: 'hello' },
    );
  });
});
