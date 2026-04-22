import {
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

const TOKEN = 'x'.repeat(32);

describe('MessagesController.inbound', () => {
  let controller: MessagesController;
  let service: { ingest: jest.Mock };

  beforeEach(async () => {
    service = { ingest: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [MessagesController],
      providers: [
        { provide: MessagesService, useValue: service },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (k: string) =>
              k === 'INTERNAL_INGEST_TOKEN' ? TOKEN : undefined,
          },
        },
      ],
    }).compile();
    controller = moduleRef.get(MessagesController);
  });

  const goodBody = {
    coachId: 'demo-coach',
    channel: 'WEB_CHAT',
    fromPhone: '+15555550001',
    fromName: 'Jane',
    content: 'hi',
    providerMessageId: 'web-uuid-1',
  };

  it('missing token → 401', async () => {
    await expect(
      controller.inbound(undefined, goodBody),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(service.ingest).not.toHaveBeenCalled();
  });

  it('wrong token → 401', async () => {
    await expect(
      controller.inbound('wrong-token', goodBody),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(service.ingest).not.toHaveBeenCalled();
  });

  it('valid token + malformed body → 422 with issues', async () => {
    const bad = { ...goodBody, fromPhone: 'not-e164' };
    const err: unknown = await controller
      .inbound(TOKEN, bad)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    const resp = (err as UnprocessableEntityException).getResponse() as {
      issues: unknown[];
    };
    expect(Array.isArray(resp.issues)).toBe(true);
    expect(resp.issues.length).toBeGreaterThan(0);
    expect(service.ingest).not.toHaveBeenCalled();
  });

  it('valid token + good body → delegates to service, returns {messageId, duplicate}', async () => {
    service.ingest.mockResolvedValue({
      messageId: 'msg-1',
      duplicate: false,
      enqueued: true,
      jobId: 'job-1',
    });
    const result = await controller.inbound(TOKEN, goodBody);
    expect(service.ingest).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ messageId: 'msg-1', duplicate: false });
  });
});
