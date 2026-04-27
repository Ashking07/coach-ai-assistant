import { Channel } from '@prisma/client';

export type ChannelSendInput = {
  coachId: string;
  messageId: string;
  parentId: string;
  content: string;
};

export type ChannelSendResult =
  | { ok: true; providerMessageId?: string }
  | { ok: false; error: string };

export interface ChannelSender {
  readonly channel: Channel;
  send(input: ChannelSendInput): Promise<ChannelSendResult>;
}
