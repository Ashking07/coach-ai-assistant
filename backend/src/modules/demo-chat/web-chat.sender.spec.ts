import { Test } from '@nestjs/testing';
import { WebChatSender } from './web-chat.sender';
import { DemoWebChatGateway } from './web-chat.gateway';

describe('WebChatSender', () => {
  it('returns ok when parent socket is available', async () => {
    const gateway = {
      sendToParent: jest.fn().mockReturnValue(true),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WebChatSender,
        { provide: DemoWebChatGateway, useValue: gateway },
      ],
    }).compile();

    const sender = moduleRef.get<WebChatSender>(WebChatSender);
    const result = await sender.send({
      coachId: 'coach-1',
      messageId: 'msg-1',
      parentId: 'parent-1',
      content: 'hello',
    });

    expect(result).toEqual({ ok: true });
  });

  it('returns failure when no parent socket is available', async () => {
    const gateway = {
      sendToParent: jest.fn().mockReturnValue(false),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WebChatSender,
        { provide: DemoWebChatGateway, useValue: gateway },
      ],
    }).compile();

    const sender = moduleRef.get<WebChatSender>(WebChatSender);
    const result = await sender.send({
      coachId: 'coach-1',
      messageId: 'msg-1',
      parentId: 'parent-404',
      content: 'hello',
    });

    expect(result).toEqual({
      ok: false,
      error: 'No active web chat socket for parent parent-404',
    });
  });
});
