import {
  CoachCommandProposalSchema,
  GEMINI_TOOL_DEFINITIONS,
} from './coach-command.types';

describe('CoachCommandProposalSchema', () => {
  it('accepts an APPROVE_PENDING proposal', () => {
    const result = CoachCommandProposalSchema.safeParse({
      kind: 'APPROVE_PENDING',
      approvalId: 'appr_123',
      summary: 'Approve reply to Priya about Thursday',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a DRAFT_REPLY proposal', () => {
    const result = CoachCommandProposalSchema.safeParse({
      kind: 'DRAFT_REPLY',
      parentName: 'Priya',
      messageBody: 'Sorry, I cannot make Thursday at 4pm.',
      summary: 'Draft reply to Priya',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown kind', () => {
    const result = CoachCommandProposalSchema.safeParse({
      kind: 'DELETE_DATABASE',
      summary: 'oh no',
    });
    expect(result.success).toBe(false);
  });

  it('exposes 7 tool definitions for Gemini', () => {
    expect(GEMINI_TOOL_DEFINITIONS).toHaveLength(7);
    const names = GEMINI_TOOL_DEFINITIONS.map((t) => t.name).sort();
    expect(names).toEqual([
      'add_availability',
      'approve_pending',
      'block_availability',
      'cancel_session',
      'dismiss_pending',
      'draft_reply',
      'schedule_session',
    ]);
  });
});
