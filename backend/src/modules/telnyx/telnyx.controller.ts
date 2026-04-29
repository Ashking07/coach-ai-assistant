import {
  Body,
  Controller,
  HttpCode,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagesService } from '../messages/messages.service';
import { TelnyxInboundSchema } from './dto/telnyx-inbound.dto';

@Controller('api/telnyx')
export class TelnyxController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly config: ConfigService,
  ) {}

  @Post('inbound')
  @HttpCode(200)
  async inbound(@Body() body: unknown): Promise<{ messageId: string; duplicate: boolean }> {
    const parsed = TelnyxInboundSchema.safeParse(body);
    if (!parsed.success) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: 'Invalid Telnyx payload',
        issues: parsed.error.issues,
      });
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
