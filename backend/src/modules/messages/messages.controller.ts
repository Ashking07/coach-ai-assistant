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
import { ParentMessageSchema } from './dto/parent-message.dto';
import { MessagesService } from './messages.service';
import { timingSafeEqualStr } from '../../common/timing-safe-equal';

@Controller('api/messages')
export class MessagesController {
  private readonly logger = new Logger(MessagesController.name);

  constructor(
    private readonly messagesService: MessagesService,
    private readonly config: ConfigService,
  ) {}

  @Post('inbound')
  @HttpCode(200)
  async inbound(
    @Headers('x-internal-token') token: string | undefined,
    @Body() body: unknown,
  ): Promise<{ messageId: string; duplicate: boolean }> {
    const expected = this.config.getOrThrow<string>('INTERNAL_INGEST_TOKEN');
    if (!token || !timingSafeEqualStr(token, expected)) {
      throw new UnauthorizedException();
    }

    const parsed = ParentMessageSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn({ event: 'INVALID_MESSAGE_PAYLOAD', issues: parsed.error.issues });
      throw new UnprocessableEntityException('Invalid message payload');
    }

    const result = await this.messagesService.ingest(parsed.data);
    return { messageId: result.messageId, duplicate: result.duplicate };
  }
}
