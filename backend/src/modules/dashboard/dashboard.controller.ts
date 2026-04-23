import {
  Body,
  Controller,
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
    @Body() body: { autonomyEnabled: boolean },
  ) {
    return this.dashboardService.updateSettings(this.guard(token), body);
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
}
