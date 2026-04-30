import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagesService } from '../messages/messages.service';
import { TelnyxInboundSchema } from './dto/telnyx-inbound.dto';
import { timingSafeEqualStr } from '../../common/timing-safe-equal';

@Controller('api/telnyx')
export class TelnyxController {
  private readonly logger = new Logger(TelnyxController.name);

  constructor(
    private readonly messagesService: MessagesService,
    private readonly config: ConfigService,
  ) {}

  @Post('inbound')
  @HttpCode(200)
  async inbound(
    @Headers('x-telnyx-token') inboundToken: string | undefined,
    @Body() body: unknown,
  ): Promise<{ messageId: string; duplicate: boolean }> {
    const expectedToken = this.config.get<string>('TELNYX_INGEST_TOKEN');
    if (expectedToken && (!inboundToken || !timingSafeEqualStr(inboundToken, expectedToken))) {
      throw new UnauthorizedException();
    }

    const parsed = TelnyxInboundSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn({ event: 'INVALID_TELNYX_PAYLOAD', issues: parsed.error.issues });
      throw new UnprocessableEntityException('Invalid Telnyx payload');
    }

    // Only process inbound SMS messages
    if (parsed.data.data.event_type !== 'message.received') {
      return { messageId: 'ignored', duplicate: false };
    }

    const coachId = this.config.getOrThrow<string>('COACH_ID');
    const payload = parsed.data.data.payload;

    const result = await this.messagesService.ingest({
      coachId,
      channel: 'SMS',
      fromPhone: payload.from.phone_number,
      fromName: undefined,
      content: payload.text,
      providerMessageId: payload.id,
      receivedAt: new Date(),
    });

    return {
      messageId: result.messageId,
      duplicate: result.duplicate,
    };
  }
}
