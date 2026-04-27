import { Inject, Injectable } from '@nestjs/common';
import { Intent } from '@prisma/client';
import { z } from 'zod';
import { CLASSIFICATION_MODEL, LLM_CLIENT } from '../llm/llm.constants';
import {
  type LlmClassifyResult,
  type LlmClient,
  type LlmUsage,
} from '../llm/llm.client';
import { LlmOutputError } from '../llm/llm.errors';

const ClassifiedIntentSchema = z.enum([
  'BOOK',
  'RESCHEDULE',
  'CANCEL',
  'QUESTION_LOGISTICS',
  'QUESTION_PROGRESS',
  'PAYMENT',
  'SMALLTALK',
  'COMPLAINT',
  'AMBIGUOUS',
  'OUT_OF_SCOPE',
]);

const IntentClassificationSchema = z.object({
  intent: ClassifiedIntentSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string().transform((s) => s.slice(0, 500)),
});

type IntentClassification = z.infer<typeof IntentClassificationSchema>;

export type ClassifyIntentInput = {
  messageId: string;
  content: string;
  parentKnown: boolean;
};

export type ClassifyIntentResult = {
  intent: Intent;
  confidence: number;
  reasoning: string;
  usage: LlmUsage;
  model: string;
  latencyMs: number;
};

const INTENT_GUIDANCE = `
You are an intent classifier for an elite solo sports coach assistant.
Classify the incoming parent message into exactly one intent:
- BOOK: asking to book or schedule a new session (e.g. "Can we book Tuesday?", "I'd like to schedule")
- RESCHEDULE: moving an existing session to a different time
- CANCEL: cancelling an existing session
- QUESTION_LOGISTICS: asking about availability, time slots, location, what to bring, or any practical scheduling detail (e.g. "Are you free today?", "Do you have any slots this week?", "What time works?", "Are you available?")
- QUESTION_PROGRESS: asking about the child's progress, performance, or coaching feedback
- PAYMENT: invoices, charges, discounts, refunds, rates, payment links
- SMALLTALK: greetings, thanks, casual non-operational chatter ("Great, thanks!", "See you then")
- COMPLAINT: dissatisfaction, frustration, or negative feedback about the service
- AMBIGUOUS: genuinely unclear — could mean multiple very different things with no coaching context
- OUT_OF_SCOPE: completely unrelated to coaching (e.g. spam, wrong number)

Rules:
- "Are you free?", "Any availability?", "Do you have time?" → always QUESTION_LOGISTICS, never AMBIGUOUS.
- Short messages from known parents asking about time/availability → QUESTION_LOGISTICS.
- Prefer a specific intent over AMBIGUOUS whenever there is any coaching-related signal.
- Reserve AMBIGUOUS only when the message is truly unintelligible or contradictory.
- When parentKnown is false, bias toward OUT_OF_SCOPE unless intent is explicit.
- Never output NOT_PROCESSED.
- Output valid JSON only.
`.trim();

@Injectable()
export class ClassifyIntentState {
  constructor(@Inject(LLM_CLIENT) private readonly llmClient: LlmClient) {}

  async classifyIntent(
    input: ClassifyIntentInput,
  ): Promise<ClassifyIntentResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await this.llmClient.classify<IntentClassification>(
          input.content,
          {
            schema: IntentClassificationSchema,
            systemPrompt: INTENT_GUIDANCE,
            userPrompt: [
              `Today's date: ${new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date())}`,
              `messageId: ${input.messageId}`,
              `parentKnown: ${input.parentKnown}`,
              `content: ${input.content}`,
              'Respond with JSON: {"intent":"...","confidence":0..1,"reasoning":"..."}',
            ].join('\n'),
            model: CLASSIFICATION_MODEL,
            temperature: 0,
          },
        );

        return this.applyDeterministicOverride(
          input.content,
          this.mapResult(result),
        );
      } catch (error) {
        lastError = error;
        const shouldRetry = error instanceof LlmOutputError && attempt === 0;

        if (!shouldRetry) {
          throw error;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Intent classification failed');
  }

  private mapResult(
    result: LlmClassifyResult<IntentClassification>,
  ): ClassifyIntentResult {
    return {
      intent: result.parsed.intent,
      confidence: result.parsed.confidence,
      reasoning: result.parsed.reasoning,
      usage: result.usage,
      model: result.model,
      latencyMs: result.latencyMs,
    };
  }

  private applyDeterministicOverride(
    content: string,
    classification: ClassifyIntentResult,
  ): ClassifyIntentResult {
    const normalized = content.toLowerCase();

    // Availability/free-time queries → always QUESTION_LOGISTICS
    const isAvailabilityQuery =
      /\b(are you free|are you available|do you have (a |any )?(slot|time|opening|availability)|any availability|free today|free tomorrow|have time|got time)\b/.test(normalized);
    if (isAvailabilityQuery) {
      return {
        ...classification,
        intent: 'QUESTION_LOGISTICS',
        confidence: Math.max(classification.confidence, 0.85),
        reasoning: 'Availability inquiry → QUESTION_LOGISTICS',
      };
    }

    if (classification.intent !== 'AMBIGUOUS') {
      return classification;
    }

    // Ambiguous with explicit booking verb + time signal → BOOK
    const hasBookingVerb = /\b(book|schedule)\b/.test(normalized);
    const hasTimeSignal =
      /\b(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|am|pm)\b/.test(
        normalized,
      ) || /\b\d{1,2}(:\d{2})?\b/.test(normalized);

    if (hasBookingVerb && hasTimeSignal) {
      return {
        ...classification,
        intent: 'BOOK',
        confidence: Math.max(classification.confidence, 0.6),
        reasoning: 'Explicit booking request with time details',
      };
    }

    return classification;
  }
}
