import { z } from 'zod';

export const TwilioInboundSchema = z.object({
  MessageSid: z.string().min(1),
  From: z
    .string()
    .transform((s) => s.replace(/^whatsapp:/, ''))
    .pipe(z.string().regex(/^\+[1-9]\d{1,14}$/, 'must be E.164')),
  Body: z.string().min(1).max(4000),
  ProfileName: z.string().optional(),
});

export type TwilioInboundBody = z.infer<typeof TwilioInboundSchema>;
