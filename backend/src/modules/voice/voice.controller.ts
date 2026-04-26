import {
  Controller,
  Headers,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqualStr } from '../../common/timing-safe-equal';
import { CoachCommandService } from './coach-command.service';

@Controller('api/voice')
export class VoiceController {
  constructor(
    private readonly commands: CoachCommandService,
    private readonly config: ConfigService,
  ) {}

  private guard(token: string | undefined): string {
    const expected = this.config.getOrThrow<string>('DASHBOARD_TOKEN');
    if (!token || !timingSafeEqualStr(token, expected)) {
      throw new UnauthorizedException();
    }
    return this.config.getOrThrow<string>('COACH_ID');
  }

  @Post('proposals/:id/confirm')
  async confirm(
    @Param('id') id: string,
    @Headers('x-dashboard-token') token: string | undefined,
  ): Promise<{ ok: true }> {
    const coachId = this.guard(token);
    await this.commands.confirm(id, coachId);
    return { ok: true };
  }

  @Post('proposals/:id/cancel')
  async cancel(
    @Param('id') id: string,
    @Headers('x-dashboard-token') token: string | undefined,
  ): Promise<{ ok: true }> {
    const coachId = this.guard(token);
    this.commands.cancel(id, coachId);
    return { ok: true };
  }
}
