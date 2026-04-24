import { z } from 'zod';

export const ChannelSchema = z.enum(['SMS', 'WEB_CHAT', 'VOICE']);
export type Channel = z.infer<typeof ChannelSchema>;

export const ParentMessageSchema = z.object({
  coachId: z.string().min(1),
  channel: ChannelSchema,
  fromPhone: z.string().regex(/^\+[1-9]\d{1,14}$/, 'must be E.164'),
  fromName: z.string().optional(),
  content: z.string().min(1).max(4000),
  providerMessageId: z.string().min(1),
  receivedAt: z.coerce.date().default(() => new Date()),
});

export type ParentMessage = z.infer<typeof ParentMessageSchema>;
