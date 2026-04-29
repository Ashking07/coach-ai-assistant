import { z } from 'zod';

export const TelnyxInboundSchema = z.object({
  data: z.object({
    event_type: z.string(),
    id: z.string(),
    payload: z.object({
      id: z.string(),
      from: z.object({
        phone_number: z.string().regex(/^\+[1-9]\d{1,14}$/),
      }),
      to: z.array(z.object({ phone_number: z.string() })).min(1),
      text: z.string().min(1).max(4000),
      type: z.string(),
    }),
  }),
});

export type TelnyxInboundBody = z.infer<typeof TelnyxInboundSchema>;
