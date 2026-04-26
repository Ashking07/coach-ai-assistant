import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqualStr } from '../../common/timing-safe-equal';
import { DashboardService } from './dashboard.service';

@Controller('api/dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly config: ConfigService,
  ) {}

  private guard(token: string | undefined): string {
    const expected = this.config.getOrThrow<string>('DASHBOARD_TOKEN');
    if (!token || !timingSafeEqualStr(token, expected)) {
      throw new UnauthorizedException();
    }
    return this.config.getOrThrow<string>('COACH_ID');
  }

  @Get('home')
  getHome(@Headers('x-dashboard-token') token: string | undefined) {
    return this.dashboardService.getHome(this.guard(token));
  }

  @Get('audit')
  getAudit(@Headers('x-dashboard-token') token: string | undefined) {
    return this.dashboardService.getAudit(this.guard(token));
  }

  @Get('parents')
  getParents(@Headers('x-dashboard-token') token: string | undefined) {
    return this.dashboardService.getParents(this.guard(token));
  }

  @Get('settings')
  getSettings(@Headers('x-dashboard-token') token: string | undefined) {
    return this.dashboardService.getSettings(this.guard(token));
  }

  @Patch('settings')
  updateSettings(
    @Headers('x-dashboard-token') token: string | undefined,
    @Body() body: unknown,
  ) {
    const parsed = body as Record<string, unknown>;
    if (!parsed || typeof parsed.autonomyEnabled !== 'boolean') {
      throw new BadRequestException('autonomyEnabled must be a boolean');
    }
    return this.dashboardService.updateSettings(this.guard(token), {
      autonomyEnabled: parsed.autonomyEnabled,
    });
  }

  @Post('approvals/:id/send')
  sendApproval(
    @Param('id') id: string,
    @Headers('x-dashboard-token') token: string | undefined,
  ) {
    return this.dashboardService.sendApproval(this.guard(token), id);
  }

  @Post('approvals/:id/dismiss')
  dismissApproval(
    @Param('id') id: string,
    @Headers('x-dashboard-token') token: string | undefined,
  ) {
    return this.dashboardService.dismissApproval(this.guard(token), id);
  }

  @Get('sessions/week')
  getWeekSessions(@Headers('x-dashboard-token') token: string | undefined) {
    return this.dashboardService.getWeekSessions(this.guard(token));
  }

  @Get('availability')
  getAvailability(@Headers('x-dashboard-token') token: string | undefined) {
    return this.dashboardService.getAvailability(this.guard(token));
  }

  @Post('availability')
  addAvailability(
    @Headers('x-dashboard-token') token: string | undefined,
    @Body() body: { startAt: string; endAt: string },
  ) {
    if (!body?.startAt || !body?.endAt) {
      throw new BadRequestException('startAt and endAt are required');
    }
    return this.dashboardService.addAvailability(this.guard(token), body.startAt, body.endAt);
  }

  @Delete('availability/:id')
  removeAvailability(
    @Param('id') id: string,
    @Headers('x-dashboard-token') token: string | undefined,
  ) {
    return this.dashboardService.removeAvailability(this.guard(token), id);
  }

  @Delete('sessions/:id')
  cancelSession(
    @Param('id') id: string,
    @Headers('x-dashboard-token') token: string | undefined,
  ) {
    return this.dashboardService.cancelSession(this.guard(token), id);
  }
}
