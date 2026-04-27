import { z } from 'zod';

export const CoachCommandProposalSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('APPROVE_PENDING'),
    approvalId: z.string().min(1),
    summary: z.string().max(280),
  }),
  z.object({
    kind: z.literal('DISMISS_PENDING'),
    approvalId: z.string().min(1),
    summary: z.string().max(280),
  }),
  z.object({
    kind: z.literal('DRAFT_REPLY'),
    parentName: z.string().min(1),
    messageBody: z.string().min(1).max(1000),
    summary: z.string().max(280),
  }),
  z.object({
    kind: z.literal('BLOCK_AVAILABILITY'),
    startAtIso: z.iso.datetime({ offset: true }),
    endAtIso: z.iso.datetime({ offset: true }),
    summary: z.string().max(280),
  }),
  z.object({
    kind: z.literal('CANCEL_SESSION'),
    sessionId: z.string().min(1),
    summary: z.string().max(280),
  }),
  z.object({
    kind: z.literal('SCHEDULE_SESSION'),
    kidId: z.string().min(1),
    kidName: z.string().min(1),
    startAtIso: z.iso.datetime({ offset: true }),
    summary: z.string().max(280),
  }),
  z.object({
    kind: z.literal('ADD_AVAILABILITY'),
    startAtIso: z.iso.datetime({ offset: true }),
    endAtIso: z.iso.datetime({ offset: true }),
    summary: z.string().max(280),
  }),
]);

export type CoachCommandProposal = z.infer<typeof CoachCommandProposalSchema>;

export interface StoredProposal {
  id: string;
  coachId: string;
  proposal: CoachCommandProposal;
  createdAt: Date;
  expiresAt: Date;
}

// Gemini Live tool definitions constrain model output to supported commands.
export const GEMINI_TOOL_DEFINITIONS = [
  {
    name: 'approve_pending',
    description:
      'Approve a pending agent reply that is waiting in the approval queue. Use the approvalId from the dashboard context.',
    parameters: {
      type: 'object',
      properties: {
        approvalId: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['approvalId', 'summary'],
    },
  },
  {
    name: 'dismiss_pending',
    description: 'Dismiss / reject a pending agent reply.',
    parameters: {
      type: 'object',
      properties: {
        approvalId: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['approvalId', 'summary'],
    },
  },
  {
    name: 'draft_reply',
    description:
      'Draft a brand-new outbound message to a parent. Use when the coach dictates a custom reply.',
    parameters: {
      type: 'object',
      properties: {
        parentName: { type: 'string' },
        messageBody: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['parentName', 'messageBody', 'summary'],
    },
  },
  {
    name: 'block_availability',
    description:
      'Block off a window of the coach calendar. ISO 8601 timestamps in the coach timezone.',
    parameters: {
      type: 'object',
      properties: {
        startAtIso: { type: 'string' },
        endAtIso: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['startAtIso', 'endAtIso', 'summary'],
    },
  },
  {
    name: 'cancel_session',
    description: 'Cancel an existing scheduled session by id.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['sessionId', 'summary'],
    },
  },
  {
    name: 'schedule_session',
    description:
      'Book a new training session for a kid. Use when the coach says "schedule", "book", "add", or "put [kid name] on the calendar / on the schedule". Use the kidId from the dashboard context.',
    parameters: {
      type: 'object',
      properties: {
        kidId: { type: 'string', description: 'ID of the kid from dashboard context' },
        kidName: { type: 'string', description: 'Display name of the kid' },
        startAtIso: { type: 'string', description: 'ISO 8601 datetime for session start' },
        summary: { type: 'string' },
      },
      required: ['kidId', 'kidName', 'startAtIso', 'summary'],
    },
  },
  {
    name: 'add_availability',
    description:
      'Mark a time window as available on the coach calendar. Use when the coach says "mark available", "open up", "add slot", "I\'m free", or "make [time] available". This is the opposite of blocking — it adds an open slot parents can book.',
    parameters: {
      type: 'object',
      properties: {
        startAtIso: { type: 'string' },
        endAtIso: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['startAtIso', 'endAtIso', 'summary'],
    },
  },
] as const;

export type GeminiToolName = (typeof GEMINI_TOOL_DEFINITIONS)[number]['name'];

export function toolCallToProposal(
  name: string,
  args: Record<string, unknown>,
): CoachCommandProposal | null {
  switch (name) {
    case 'approve_pending':
      return CoachCommandProposalSchema.parse({ kind: 'APPROVE_PENDING', ...args });
    case 'dismiss_pending':
      return CoachCommandProposalSchema.parse({ kind: 'DISMISS_PENDING', ...args });
    case 'draft_reply':
      return CoachCommandProposalSchema.parse({ kind: 'DRAFT_REPLY', ...args });
    case 'block_availability':
      return CoachCommandProposalSchema.parse({ kind: 'BLOCK_AVAILABILITY', ...args });
    case 'cancel_session':
      return CoachCommandProposalSchema.parse({ kind: 'CANCEL_SESSION', ...args });
    case 'schedule_session':
      return CoachCommandProposalSchema.parse({ kind: 'SCHEDULE_SESSION', ...args });
    case 'add_availability':
      return CoachCommandProposalSchema.parse({ kind: 'ADD_AVAILABILITY', ...args });
    default:
      return null;
  }
}
