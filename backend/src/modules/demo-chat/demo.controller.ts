import {
  Body,
  Controller,
  Headers,
  HttpCode,
  NotFoundException,
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

type ParentSessionBody = z.infer<typeof ParentSessionBodySchema>;

@Controller('api/demo')
export class DemoController {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tokenService: DemoTokenService,
  ) {}

  @Post('parent-session')
  @HttpCode(200)
  async createParentSession(
    @Headers('x-dashboard-token') token: string | undefined,
    @Body() body: ParentSessionBody,
  ): Promise<{ token: string; expiresAt: string; wsUrl: string }> {
    this.assertDashboardToken(token);

    const parsed = ParentSessionBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: 'Invalid parent session payload',
        issues: parsed.error.issues,
      });
    }

    const parent = await this.prisma.parent.findUnique({
      where: { id: parsed.data.parentId },
      select: { id: true },
    });

    if (!parent) {
      throw new NotFoundException('Parent not found');
    }

    const issued = this.tokenService.issueParentToken(parsed.data.parentId);
    const wsUrl = `${this.getWsBaseUrl()}/ws/demo-parent?token=${issued.token}`;

    return {
      token: issued.token,
      expiresAt: issued.expiresAt.toISOString(),
      wsUrl,
    };
  }

  private assertDashboardToken(token: string | undefined): void {
    const expected = this.config.getOrThrow<string>('DASHBOARD_TOKEN');
    if (!token || !timingSafeEqualStr(token, expected)) {
      throw new UnauthorizedException();
    }
  }

  private getWsBaseUrl(): string {
    const publicBase = this.config.getOrThrow<string>('PUBLIC_BASE_URL');
    if (publicBase.startsWith('https://')) {
      return publicBase.replace(/^https:/, 'wss:');
    }
    if (publicBase.startsWith('http://')) {
      return publicBase.replace(/^http:/, 'ws:');
    }
    return publicBase;
  }
}
