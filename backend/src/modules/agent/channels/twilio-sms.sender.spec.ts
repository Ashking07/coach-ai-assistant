import { Test } from '@nestjs/testing';
import twilio from 'twilio';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma.service';
import { TwilioSmsSender } from './twilio-sms.sender';

jest.mock('twilio', () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe('TwilioSmsSender', () => {
  const twilioFactory = twilio as unknown as jest.Mock;

  beforeEach(() => {
    twilioFactory.mockReset();
  });

  it('returns failure when Twilio credentials are missing', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        TwilioSmsSender,
        {
          provide: PrismaService,
          useValue: {
            parent: {
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(undefined),
          },
        },
      ],
    }).compile();

    const sender = moduleRef.get<TwilioSmsSender>(TwilioSmsSender);
    const result = await sender.send({
      coachId: 'coach-1',
      messageId: 'msg-1',
      parentId: 'parent-1',
      content: 'hello',
    });

    expect(result).toEqual({
      ok: false,
      error: 'Twilio credentials are not configured',
    });
    expect(twilioFactory).not.toHaveBeenCalled();
  });

  it('sends SMS and returns provider message id', async () => {
    const createMock = jest.fn().mockResolvedValue({ sid: 'SM123' });
    twilioFactory.mockReturnValue({
      messages: {
        create: createMock,
      },
    });

    const prisma = {
      parent: {
        findUnique: jest.fn().mockResolvedValue({ phone: '+15555550123' }),
      },
    };

    const config = {
      get: (key: string) => {
        const map: Record<string, string> = {
          TWILIO_ACCOUNT_SID: 'AC123',
          TWILIO_AUTH_TOKEN: 'token',
          TWILIO_PHONE_NUMBER: '+15555550001',
        };
        return map[key];
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TwilioSmsSender,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    const sender = moduleRef.get<TwilioSmsSender>(TwilioSmsSender);
    const result = await sender.send({
      coachId: 'coach-1',
      messageId: 'msg-1',
      parentId: 'parent-1',
      content: 'hello world',
    });

    expect(prisma.parent.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'parent-1' },
      }),
    );
    expect(createMock).toHaveBeenCalledWith({
      to: '+15555550123',
      from: '+15555550001',
      body: 'hello world',
    });
    expect(result).toEqual({ ok: true, providerMessageId: 'SM123' });
  });
});
