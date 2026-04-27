import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { PrismaService } from '../../prisma.service';
import { timingSafeEqualStr } from '../../common/timing-safe-equal';
import { DemoTokenService } from './demo-token.service';

const ParentSessionBodySchema = z.object({
  parentId: z.string().min(1),
});

// In-memory lock: parentId → expiry epoch ms
const activeClaims = new Map<string, number>();

function pruneClaims(): void {
  const now = Date.now();
  for (const [id, exp] of activeClaims) {
    if (exp <= now) activeClaims.delete(id);
  }
}

@Controller('api/demo')
export class DemoController {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tokenService: DemoTokenService,
  ) {}

  // ── Coach-only: generate a session for any parent ──────────────────────────

  @Post('parent-session')
  @HttpCode(200)
  async createParentSession(
    @Headers('x-dashboard-token') token: string | undefined,
    @Body() body: unknown,
  ): Promise<{ token: string; expiresAt: string; wsUrl: string }> {
    this.assertDashboardToken(token);

    const parsed = ParentSessionBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new UnprocessableEntityException('Invalid parent session payload');
    }

    const parent = await this.prisma.parent.findUnique({
      where: { id: parsed.data.parentId },
      select: { id: true },
    });
    if (!parent) throw new NotFoundException('Parent not found');

    const issued = this.tokenService.issueParentToken(parsed.data.parentId);
    activeClaims.set(parsed.data.parentId, issued.expiresAt.getTime());

    return {
      token: issued.token,
      expiresAt: issued.expiresAt.toISOString(),
      wsUrl: this.buildWsUrl(issued.token),
    };
  }

  // ── Public: list parents for the picker screen ────────────────────────────

  @Get('parents')
  async listParents(): Promise<
    { id: string; name: string; kids: string[] }[]
  > {
    this.assertDemoEnabled();
    const coachId = this.config.getOrThrow<string>('COACH_ID');
    const parents = await this.prisma.parent.findMany({
      where: { coachId },
      include: { kids: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    return parents.map((p) => ({
      id: p.id,
      name: p.name,
      kids: p.kids.map((k) => k.name),
    }));
  }

  // ── Public: availability map for the picker screen ────────────────────────

  @Get('availability')
  getAvailability(): Record<string, number> {
    this.assertDemoEnabled();
    pruneClaims();
    return Object.fromEntries(activeClaims);
  }

  // ── Public: claim a parent slot (one at a time) ───────────────────────────

  @Post('claim/:parentId')
  @HttpCode(200)
  async claimParent(
    @Param('parentId') parentId: string,
  ): Promise<{ token: string; expiresAt: string; wsUrl: string }> {
    this.assertDemoEnabled();
    pruneClaims();

    if (activeClaims.has(parentId)) {
      throw new ConflictException('Parent is already in use');
    }

    const parent = await this.prisma.parent.findUnique({
      where: { id: parentId },
      select: { id: true },
    });
    if (!parent) throw new NotFoundException('Parent not found');

    const issued = this.tokenService.issueParentToken(parentId);
    activeClaims.set(parentId, issued.expiresAt.getTime());

    return {
      token: issued.token,
      expiresAt: issued.expiresAt.toISOString(),
      wsUrl: this.buildWsUrl(issued.token),
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private assertDashboardToken(token: string | undefined): void {
    const expected = this.config.getOrThrow<string>('DASHBOARD_TOKEN');
    if (!token || !timingSafeEqualStr(token, expected)) {
      throw new UnauthorizedException();
    }
  }

  private assertDemoEnabled(): void {
    const enabled = this.config.get<boolean>('DEMO_PARENT_CHAT_ENABLED');
    if (!enabled) throw new NotFoundException();
  }

  private buildWsUrl(token: string): string {
    const publicBase = this.config.getOrThrow<string>('PUBLIC_BASE_URL');
    const wsBase = publicBase.startsWith('https://')
      ? publicBase.replace(/^https:/, 'wss:')
      : publicBase.replace(/^http:/, 'ws:');
    return `${wsBase}/ws/demo-parent?token=${token}`;
  }
}
