import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateRequest } from 'twilio';

type TwilioRequest = {
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
  originalUrl: string;
};

@Injectable()
export class TwilioSignatureGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<TwilioRequest>();
    const nodeEnv = this.config.getOrThrow<string>('NODE_ENV');
    const verificationDisabled = this.parseTrue(
      this.config.get('TWILIO_WEBHOOK_VERIFY_DISABLED'),
    );

    if (nodeEnv !== 'production' && verificationDisabled) {
      return true;
    }

    const signature = this.extractHeader(req.headers['x-twilio-signature']);
    if (!signature) {
      throw new UnauthorizedException('Missing Twilio signature header');
    }

    const authToken = this.config.getOrThrow<string>('TWILIO_AUTH_TOKEN');
    const baseUrl = this.config.getOrThrow<string>('PUBLIC_BASE_URL');
    const webhookUrl = new URL(req.originalUrl, baseUrl).toString();
    const formParams = this.normalizeForm(req.body);

    const valid = validateRequest(authToken, signature, webhookUrl, formParams);
    if (!valid) {
      throw new UnauthorizedException('Invalid Twilio signature');
    }

    return true;
  }

  private parseTrue(value: unknown): boolean {
    return value === true || value === 'true' || value === '1';
  }

  private extractHeader(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) {
      return value[0] ?? null;
    }
    return value ?? null;
  }

  private normalizeForm(body: Record<string, unknown>): Record<string, string> {
    return Object.entries(body).reduce<Record<string, string>>((acc, entry) => {
      const [key, value] = entry;
      if (value === undefined || value === null) {
        return acc;
      }
      acc[key] = String(value);
      return acc;
    }, {});
  }
}
