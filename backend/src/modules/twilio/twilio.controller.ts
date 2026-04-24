import {
  Body,
  Controller,
  HttpCode,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagesService } from '../messages/messages.service';
import { TwilioInboundSchema } from './dto/twilio-inbound.dto';
import { TwilioSignatureGuard } from './twilio-signature.guard';

@Controller('api/twilio')
export class TwilioController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly config: ConfigService,
  ) {}

  @Post('inbound')
  @HttpCode(200)
  @UseGuards(TwilioSignatureGuard)
  async inbound(
    @Body() body: unknown,
  ): Promise<{ messageId: string; duplicate: boolean }> {
    const parsed = TwilioInboundSchema.safeParse(body);
    if (!parsed.success) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: 'Invalid Twilio payload',
        issues: parsed.error.issues,
      });
    }

    const coachId = this.config.getOrThrow<string>('COACH_ID');

    const result = await this.messagesService.ingest({
      coachId,
      channel: 'SMS',
      fromPhone: parsed.data.From,
      fromName: parsed.data.ProfileName,
      content: parsed.data.Body,
      providerMessageId: parsed.data.MessageSid,
      receivedAt: new Date(),
    });

    return {
      messageId: result.messageId,
      duplicate: result.duplicate,
    };
  }
}
