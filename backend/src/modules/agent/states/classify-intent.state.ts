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
  reasoning: z.string().max(280),
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
You are an intent classifier for an elite solo coach assistant.
Classify the incoming parent message into exactly one intent:
- BOOK: asking to book a new session
- RESCHEDULE: moving an existing session
- CANCEL: cancelling a session
- QUESTION_LOGISTICS: time, location, what to bring, practical details
- QUESTION_PROGRESS: child progress updates or coaching feedback
- PAYMENT: invoices, charges, discounts, refunds, rates, payment links
- SMALLTALK: greetings, thanks, non-operational chatter
- COMPLAINT: dissatisfaction, frustration, negative feedback
- AMBIGUOUS: unclear request or insufficient information
- OUT_OF_SCOPE: unrelated to coaching operations

Rules:
- If the message explicitly asks to book/schedule a session with a kid and a time window, classify as BOOK.
- If a message asks to move an existing booking, classify as RESCHEDULE.
- Return AMBIGUOUS when message meaning is uncertain.
- Unknown sender risk is high: when parentKnown is false, bias toward AMBIGUOUS or OUT_OF_SCOPE unless the intent is explicit.
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
    if (classification.intent !== 'AMBIGUOUS') {
      return classification;
    }

    const normalized = content.toLowerCase();
    const hasBookingVerb = /\b(book|schedule)\b/.test(normalized);
    const hasTimeSignal =
      /\b(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|am|pm)\b/.test(
        normalized,
      ) || /\b\d{1,2}(:\d{2})?\b/.test(normalized);

    if (!hasBookingVerb || !hasTimeSignal) {
      return classification;
    }

    return {
      ...classification,
      intent: 'BOOK',
      confidence: Math.max(classification.confidence, 0.6),
      reasoning: 'Explicit booking request with time details',
    };
  }
}
