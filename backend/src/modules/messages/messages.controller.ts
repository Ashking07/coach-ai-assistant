import {
  Body,
  Controller,
  Headers,
  HttpCode,
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
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: 'Invalid message payload',
        issues: parsed.error.issues,
      });
    }

    const result = await this.messagesService.ingest(parsed.data);
    return { messageId: result.messageId, duplicate: result.duplicate };
  }
}
