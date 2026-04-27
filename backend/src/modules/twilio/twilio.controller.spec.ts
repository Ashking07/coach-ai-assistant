import { Test } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TwilioController } from './twilio.controller';
import { MessagesService } from '../messages/messages.service';

describe('TwilioController', () => {
  let controller: TwilioController;
  let messagesService: { ingest: jest.Mock };

  beforeEach(async () => {
    messagesService = {
      ingest: jest.fn().mockResolvedValue({
        messageId: 'msg-1',
        duplicate: false,
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TwilioController],
      providers: [
        { provide: MessagesService, useValue: messagesService },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              if (key === 'COACH_ID') return 'demo-coach';
              throw new Error(`unexpected key: ${key}`);
            },
          },
        },
      ],
    }).compile();

    controller = moduleRef.get<TwilioController>(TwilioController);
  });

  it('maps Twilio form body to ParentMessage and delegates to ingest', async () => {
    const response = await controller.inbound({
      MessageSid: 'SM123',
      From: '+15555550123',
      ProfileName: 'Priya Parent',
      Body: 'Can we book Thursday?',
    });

    expect(messagesService.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        coachId: 'demo-coach',
        channel: 'SMS',
        fromPhone: '+15555550123',
        fromName: 'Priya Parent',
        content: 'Can we book Thursday?',
        providerMessageId: 'SM123',
        receivedAt: expect.any(Date),
      }),
    );
    expect(response).toEqual({ messageId: 'msg-1', duplicate: false });
  });

  it('returns 422 when Twilio form body is invalid', async () => {
    await expect(
      controller.inbound({
        MessageSid: '',
        From: 'not-e164',
        Body: '',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
