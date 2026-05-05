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
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { timingSafeEqualStr } from '../../common/timing-safe-equal';
import { DashboardService } from './dashboard.service';
import { StripeService } from '../stripe/stripe.service';

@Controller('api/dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly config: ConfigService,
    private readonly stripeService: StripeService,
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

  @Post('stripe/onboard')
  async startStripeOnboarding(@Headers('x-dashboard-token') token: string | undefined) {
    return this.stripeService.createConnectAccount(this.guard(token));
  }

  @Get('stripe/onboard/return')
  stripeOnboardReturn() {
    return { ok: true };
  }

  @Post('stripe/refresh')
  async refreshStripe(@Headers('x-dashboard-token') token: string | undefined) {
    await this.stripeService.refreshConnectStatus(this.guard(token));
    return this.dashboardService.getSettings(this.guard(token));
  }

  @Get('stripe/debug')
  async stripeDebug(@Headers('x-dashboard-token') token: string | undefined) {
    return this.stripeService.getAccountDebug(this.guard(token));
  }

  @Post('stripe/login-link')
  async stripeLoginLink(@Headers('x-dashboard-token') token: string | undefined) {
    return this.stripeService.createExpressLoginLink(this.guard(token));
  }

  @Patch('settings')
  updateSettings(
    @Headers('x-dashboard-token') token: string | undefined,
    @Body() body: unknown,
  ) {
    const schema = z.object({
      autonomyEnabled: z.boolean().optional(),
      defaultRateCents: z.number().int().min(0).max(100000).optional(),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success || (!('autonomyEnabled' in parsed.data) && !('defaultRateCents' in parsed.data))) {
      throw new BadRequestException('Invalid settings payload');
    }
    return this.dashboardService.updateSettings(this.guard(token), parsed.data);
  }

  @Post('approvals/:id/send')
  sendApproval(
    @Param('id') id: string,
    @Headers('x-dashboard-token') token: string | undefined,
    @Body() body: unknown,
  ) {
    const draft = (body as Record<string, unknown>)?.draft;
    if (typeof draft === 'string' && draft.length > 2000) {
      throw new BadRequestException('draft must be 2000 characters or fewer');
    }
    return this.dashboardService.sendApproval(
      this.guard(token),
      id,
      typeof draft === 'string' ? draft : undefined,
    );
  }

  @Post('approvals/:id/dismiss')
  dismissApproval(
    @Param('id') id: string,
    @Headers('x-dashboard-token') token: string | undefined,
  ) {
    return this.dashboardService.dismissApproval(this.guard(token), id);
  }

  @Post('fires/:id/dismiss')
  dismissFire(
    @Param('id') id: string,
    @Headers('x-dashboard-token') token: string | undefined,
  ) {
    return this.dashboardService.dismissFire(this.guard(token), id);
  }

  @Get('sessions/week')
  getWeekSessions(
    @Headers('x-dashboard-token') token: string | undefined,
    @Query('weekStart') weekStart?: string,
  ) {
    if (weekStart !== undefined) {
      const d = new Date(weekStart);
      if (isNaN(d.getTime())) throw new BadRequestException('Invalid weekStart date');
    }
    return this.dashboardService.getWeekSessions(this.guard(token), weekStart);
  }

  @Get('availability')
  getAvailability(
    @Headers('x-dashboard-token') token: string | undefined,
    @Query('weekStart') weekStart?: string,
  ) {
    if (weekStart !== undefined) {
      const d = new Date(weekStart);
      if (isNaN(d.getTime())) throw new BadRequestException('Invalid weekStart date');
    }
    return this.dashboardService.getAvailability(this.guard(token), weekStart);
  }

  @Get('kids')
  getKids(@Headers('x-dashboard-token') token: string | undefined) {
    return this.dashboardService.getKids(this.guard(token));
  }

  @Patch('kids/:id')
  updateKid(
    @Param('id') id: string,
    @Headers('x-dashboard-token') token: string | undefined,
    @Body() body: unknown,
  ) {
    const schema = z.object({
      rateCentsOverride: z.number().int().min(0).max(100000).nullable(),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Invalid kid payload');
    }
    return this.dashboardService.updateKidRate(this.guard(token), id, parsed.data.rateCentsOverride);
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

  @Post('sessions')
  createSession(
    @Headers('x-dashboard-token') token: string | undefined,
    @Body() body: unknown,
  ) {
    const schema = z.object({
      kidId: z.string().min(1),
      scheduledAt: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?Z$/),
      durationMinutes: z.union([z.literal(30), z.literal(45), z.literal(60), z.literal(90)]),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Invalid session payload');
    }

    return this.dashboardService.scheduleSession(
      this.guard(token),
      parsed.data.kidId,
      parsed.data.scheduledAt,
      parsed.data.durationMinutes,
    );
  }

  @Post('sessions/:id/payment-link')
  sendPaymentLink(
    @Param('id') id: string,
    @Headers('x-dashboard-token') token: string | undefined,
  ) {
    return this.dashboardService.sendPaymentLink(this.guard(token), id);
  }

  @Post('sessions/:id/mark-paid')
  markPaid(
    @Param('id') id: string,
    @Headers('x-dashboard-token') token: string | undefined,
    @Body() body: unknown,
  ) {
    const schema = z.object({
      method: z.enum(['CASH', 'VENMO', 'ZELLE', 'CHECK', 'OTHER']),
      notes: z.string().max(1000).optional(),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Invalid payment payload');
    }
    return this.dashboardService.markSessionPaid(
      this.guard(token),
      id,
      parsed.data.method,
      parsed.data.notes,
    );
  }

  @Post('sessions/:id/recap')
  createSessionRecap(
    @Param('id') id: string,
    @Headers('x-dashboard-token') token: string | undefined,
    @Body() body: unknown,
  ) {
    const parsed = body as Record<string, unknown>;
    if (!parsed || typeof parsed.transcript !== 'string') {
      throw new BadRequestException('transcript is required and must be a string');
    }
    if (parsed.transcript.length > 8000) {
      throw new BadRequestException('transcript must be 8000 characters or fewer');
    }
    return this.dashboardService.createSessionRecap(this.guard(token), id, parsed.transcript);
  }

  @Post('kill-switch')
  pauseAgent(@Headers('x-dashboard-token') token: string | undefined) {
    return this.dashboardService.pauseAgent(this.guard(token));
  }

  @Delete('kill-switch')
  resumeAgent(@Headers('x-dashboard-token') token: string | undefined) {
    return this.dashboardService.resumeAgent(this.guard(token));
  }
}
