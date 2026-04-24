import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma.service';
import { DemoController } from './demo.controller';
import { DemoTokenService } from './demo-token.service';

describe('DemoController', () => {
  let controller: DemoController;
  const prisma = {
    parent: {
      findUnique: jest.fn(),
    },
  };
  const tokenService = {
    issueParentToken: jest.fn(),
  };

  beforeEach(async () => {
    prisma.parent.findUnique.mockReset();
    tokenService.issueParentToken.mockReset();

    const moduleRef = await Test.createTestingModule({
      controllers: [DemoController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: DemoTokenService, useValue: tokenService },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              const map: Record<string, string> = {
                DASHBOARD_TOKEN: 'dashboard-secret',
                PUBLIC_BASE_URL: 'https://coach.example.com',
              };
              const value = map[key];
              if (!value) throw new Error(`unexpected key: ${key}`);
              return value;
            },
          },
        },
      ],
    }).compile();

    controller = moduleRef.get<DemoController>(DemoController);
  });

  it('returns demo parent session for a real parent when dashboard token is valid', async () => {
    prisma.parent.findUnique.mockResolvedValue({ id: 'parent-1' });
    tokenService.issueParentToken.mockReturnValue({
      token: 'demo-token',
      expiresAt: new Date('2026-04-24T12:15:00Z'),
    });

    const res = await controller.createParentSession('dashboard-secret', {
      parentId: 'parent-1',
    });

    expect(prisma.parent.findUnique).toHaveBeenCalledWith({
      where: { id: 'parent-1' },
      select: { id: true },
    });
    expect(tokenService.issueParentToken).toHaveBeenCalledWith('parent-1');
    expect(res).toEqual({
      token: 'demo-token',
      expiresAt: '2026-04-24T12:15:00.000Z',
      wsUrl:
        'wss://coach.example.com/ws/demo-parent?token=demo-token',
    });
  });

  it('rejects invalid dashboard token', async () => {
    await expect(
      controller.createParentSession('invalid', { parentId: 'parent-1' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
