import { Inject, Injectable } from '@nestjs/common';
import { ConfidenceTier, type Intent, type Message } from '@prisma/client';
import { z } from 'zod';
import { DRAFTING_MODEL, LLM_CLIENT } from '../llm/llm.constants';
import type { LlmClient, LlmUsage } from '../llm/llm.client';
import type { AgentContext } from './load-context.state';

export type DraftReplyInput = {
  message: Message;
  context: AgentContext;
  intent: Intent;
  tier: ConfidenceTier;
};

export type DraftReplyResult = {
  draft: string;
  usage: LlmUsage;
  model: string;
  latencyMs: number;
};

const DraftReplySchema = z.object({ reply: z.string().transform((s) => s.slice(0, 500)) });

const DRAFT_SYSTEM_PROMPT = `
You are an SMS reply drafter for a solo sports coach.
Tone: warm, professional, brief.
Rules:
- Maximum 3 sentences.
- Never invent facts not provided to you.
- Only reference session times that appear verbatim in the provided available slots list.
- If no available slots are listed, do not invent times — offer to check with the coach instead.
`.trim();

@Injectable()
export class DraftReplyState {
  constructor(@Inject(LLM_CLIENT) private readonly llm: LlmClient) {}

  async draft(input: DraftReplyInput): Promise<DraftReplyResult> {
    const slotsText =
      input.context.availableSlots.length > 0
        ? input.context.availableSlots.map((s) => `- ${s.label}`).join('\n')
        : 'No available slots';

    const tierHint =
      input.tier === ConfidenceTier.AUTO
        ? 'Reply confidently and decisively.'
        : 'Reply warmly but tentatively — the coach will review before sending.';

    const userPrompt = [
      `Parent name: ${input.context.parent.name}`,
      `Kids: ${input.context.kids.map((k) => k.name).join(', ')}`,
      `Intent: ${input.intent}`,
      `Available slots:\n${slotsText}`,
      `Original message: ${input.message.content}`,
      tierHint,
      'Respond with JSON: { "reply": "..." }',
    ].join('\n');

    const result = await this.llm.classify(input.message.content, {
      schema: DraftReplySchema,
      systemPrompt: DRAFT_SYSTEM_PROMPT,
      userPrompt,
      model: DRAFTING_MODEL,
      maxTokens: 350,
      temperature: 0.3,
    });

    return {
      draft: result.parsed.reply,
      usage: result.usage,
      model: result.model,
      latencyMs: result.latencyMs,
    };
  }
}
