import { Inject, Injectable } from '@nestjs/common';
import { ConfidenceTier, type Intent, type Message } from '@prisma/client';
import { z } from 'zod';
import { DRAFTING_MODEL, LLM_CLIENT } from '../llm/llm.constants';
import type { LlmClient, LlmUsage } from '../llm/llm.client';
import { LlmOutputError } from '../llm/llm.errors';
import type { AgentContext } from './load-context.state';

export type DraftReplyInput = {
  message: Message;
  context: AgentContext;
  intent: Intent;
  tier: ConfidenceTier;
};

export type DraftReplyResult = {
  draft: string;
  bookedSlotIso: string | null;
  sessionNote: string | null;
  usage: LlmUsage;
  model: string;
  latencyMs: number;
};

const DraftReplySchema = z.object({
  reply: z.string().transform((s) => s.slice(0, 500)),
  booked_slot_iso: z.string().nullish().transform((v) => v ?? null),
  session_note: z.string().nullish().transform((v) => (v ? v.slice(0, 120) : null)),
});

const DRAFT_SYSTEM_PROMPT = `
You are an SMS reply drafter for a solo sports coach.
Tone: warm, professional, brief.
Rules:
- Maximum 3 sentences.
- Never invent facts not provided to you.
- Use the conversation history to maintain context — if the parent refers to something said earlier, acknowledge it naturally.
- Only reference session times that appear verbatim in the provided available slots list.
- If no available slots are listed, do not invent times — offer to check with the coach instead.
- When you confirm a booking for a specific slot, include its ISO datetime in the JSON as "booked_slot_iso".
  Use the [iso: ...] value from the slot list exactly. Only set this field when you are confirming a booking.
- If the parent shares actionable information about their child (medical, injury, equipment, dietary, scheduling notes),
  extract a concise coach-facing note (≤100 chars) and include it as "session_note". Omit if there is nothing noteworthy.

IMPORTANT: Always respond with valid JSON only — no preamble, no explanation, no markdown.
Format: { "reply": "...", "booked_slot_iso": null, "session_note": null }
`.trim();

@Injectable()
export class DraftReplyState {
  constructor(@Inject(LLM_CLIENT) private readonly llm: LlmClient) {}

  async draft(input: DraftReplyInput): Promise<DraftReplyResult> {
    const slotsText =
      input.context.availableSlots.length > 0
        ? input.context.availableSlots
            .map((s) => `- ${s.label} [iso: ${s.startAt.toISOString()}]`)
            .join('\n')
        : 'No available slots';

    const tierHint =
      input.tier === ConfidenceTier.AUTO
        ? 'Reply confidently and decisively.'
        : 'Reply warmly but tentatively — the coach will review before sending.';

    const todayLabel = new Intl.DateTimeFormat('en-US', {
      timeZone: input.context.timezone,
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date());

    const historyMessages = [...input.context.recentMessages]
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
      .filter((m) => m.id !== input.message.id)
      .slice(-8);

    const historyText = historyMessages.length > 0
      ? historyMessages
          .map((m) => `${m.direction === 'INBOUND' ? 'Parent' : 'Coach'}: ${m.content}`)
          .join('\n')
      : 'No prior messages';

    const userPrompt = [
      `Today's date: ${todayLabel}`,
      `Parent name: ${input.context.parent.name}`,
      `Kids: ${input.context.kids.map((k) => k.name).join(', ')}`,
      `Intent: ${input.intent}`,
      `Available slots:\n${slotsText}`,
      `Conversation history (oldest first):\n${historyText}`,
      `Current message: ${input.message.content}`,
      tierHint,
    ].join('\n');

    let result;
    try {
      result = await this.llm.classify(input.message.content, {
        schema: DraftReplySchema,
        systemPrompt: DRAFT_SYSTEM_PROMPT,
        userPrompt,
        model: DRAFTING_MODEL,
        maxTokens: 400,
        temperature: 0.3,
      });
    } catch (err) {
      // If the model returned plain prose instead of JSON, use it directly as the reply
      if (err instanceof LlmOutputError && err.rawText && err.rawText.length > 10) {
        return {
          draft: err.rawText.slice(0, 500),
          bookedSlotIso: null,
          sessionNote: null,
          usage: { tokensIn: 0, tokensOut: 0 },
          model: DRAFTING_MODEL,
          latencyMs: 0,
        };
      }
      throw err;
    }

    return {
      draft: result.parsed.reply,
      bookedSlotIso: result.parsed.booked_slot_iso ?? null,
      sessionNote: result.parsed.session_note ?? null,
      usage: result.usage,
      model: result.model,
      latencyMs: result.latencyMs,
    };
  }
}
