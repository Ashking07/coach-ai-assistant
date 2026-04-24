import { Test } from '@nestjs/testing';
import { Channel } from '@prisma/client';
import { CHANNEL_SENDERS } from './channel-sender.constants';
import { ChannelSenderRegistry } from './channel-sender.registry';
import type { ChannelSender } from './channel-sender.port';

describe('ChannelSenderRegistry', () => {
  it('returns sender for a registered channel', async () => {
    const smsSender: ChannelSender = {
      channel: Channel.SMS,
      send: jest.fn().mockResolvedValue({ ok: true, providerMessageId: 'sid' }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelSenderRegistry,
        {
          provide: CHANNEL_SENDERS,
          useValue: [smsSender],
        },
      ],
    }).compile();

    const registry = moduleRef.get<ChannelSenderRegistry>(ChannelSenderRegistry);
    expect(registry.get(Channel.SMS)).toBe(smsSender);
  });

  it('throws when channel sender is not registered', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelSenderRegistry,
        {
          provide: CHANNEL_SENDERS,
          useValue: [],
        },
      ],
    }).compile();

    const registry = moduleRef.get<ChannelSenderRegistry>(ChannelSenderRegistry);
    expect(() => registry.get(Channel.SMS)).toThrow(/No channel sender registered/);
  });
});
