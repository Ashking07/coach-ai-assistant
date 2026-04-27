import { Injectable } from '@nestjs/common';
import { Channel, ConfidenceTier } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma.service';
import type { ClassifyIntentResult } from '../states/classify-intent.state';
import type { DraftReplyResult } from '../states/draft-reply.state';
import { ChannelSenderRegistry } from '../channels/channel-sender.registry';

type SendBase = {
  coachId: string;
  messageId: string;
  parentId: string;
  channel: Channel;
  classifyResult: ClassifyIntentResult;
  draftResult: DraftReplyResult;
};

export type EscalateParams = {
  coachId: string;
  messageId: string;
  reason: string;
  actionTaken: 'ESCALATED' | 'CLASSIFY_FAILED' | 'DRAFT_FAILED' | 'SEND_FAILED';
  classifyResult?: ClassifyIntentResult;
};

@Injectable()
export class OutboundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channelSenderRegistry: ChannelSenderRegistry,
  ) {}

  async autoSend(params: SendBase): Promise<void> {
    const { classifyResult, draftResult } = params;

    await this.prisma.message.create({
      data: {
        coachId: params.coachId,
        parentId: params.parentId,
        direction: 'OUTBOUND',
        channel: params.channel,
        providerMessageId: randomUUID(),
        content: draftResult.draft,
        receivedAt: new Date(),
      },
    });

    await this.prisma.agentDecision.create({
      data: {
        coachId: params.coachId,
        messageId: params.messageId,
        intent: classifyResult.intent,
        confidence: classifyResult.confidence,
        tier: ConfidenceTier.AUTO,
        actionTaken: 'AUTO_SENT',
        reasoning: classifyResult.reasoning,
        llmModel: draftResult.model,
        tokensIn: classifyResult.usage.tokensIn + draftResult.usage.tokensIn,
        tokensOut: classifyResult.usage.tokensOut + draftResult.usage.tokensOut,
        latencyMs: Math.round(classifyResult.latencyMs + draftResult.latencyMs),
      },
    });

    await this.sendViaChannelSender(params);
  }

  async queueForApproval(params: SendBase): Promise<void> {
    const { classifyResult, draftResult } = params;

    await this.prisma.approvalQueue.create({
      data: {
        coachId: params.coachId,
        messageId: params.messageId,
        draftReply: draftResult.draft,
      },
    });

    await this.prisma.agentDecision.create({
      data: {
        coachId: params.coachId,
        messageId: params.messageId,
        intent: classifyResult.intent,
        confidence: classifyResult.confidence,
        tier: ConfidenceTier.APPROVE,
        actionTaken: 'QUEUED_FOR_APPROVAL',
        reasoning: classifyResult.reasoning,
        llmModel: draftResult.model,
        tokensIn: classifyResult.usage.tokensIn + draftResult.usage.tokensIn,
        tokensOut: classifyResult.usage.tokensOut + draftResult.usage.tokensOut,
        latencyMs: Math.round(classifyResult.latencyMs + draftResult.latencyMs),
      },
    });
  }

  async escalate(params: EscalateParams): Promise<void> {
    const cr = params.classifyResult;

    await this.prisma.agentDecision.create({
      data: {
        coachId: params.coachId,
        messageId: params.messageId,
        intent: cr?.intent ?? 'AMBIGUOUS',
        confidence: cr?.confidence ?? 0,
        tier: ConfidenceTier.ESCALATE,
        actionTaken: params.actionTaken,
        reasoning: params.reason,
        llmModel: cr?.model ?? null,
        tokensIn: cr?.usage.tokensIn ?? null,
        tokensOut: cr?.usage.tokensOut ?? null,
        latencyMs: cr ? Math.round(cr.latencyMs) : null,
      },
    });
  }

  private async sendViaChannelSender(params: SendBase): Promise<void> {
    try {
      const sender = this.channelSenderRegistry.get(params.channel);
      const result = await sender.send({
        coachId: params.coachId,
        messageId: params.messageId,
        parentId: params.parentId,
        content: params.draftResult.draft,
      });

      if (!result.ok) {
        await this.appendDeliveryFailureDecision(params, result.error);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown send error';
      await this.appendDeliveryFailureDecision(params, reason);
    }
  }

  private async appendDeliveryFailureDecision(
    params: SendBase,
    reason: string,
  ): Promise<void> {
    const { classifyResult, draftResult } = params;

    await this.prisma.agentDecision.create({
      data: {
        coachId: params.coachId,
        messageId: params.messageId,
        intent: classifyResult.intent,
        confidence: classifyResult.confidence,
        tier: ConfidenceTier.AUTO,
        actionTaken: 'DELIVERY_FAILED',
        reasoning: reason,
        llmModel: draftResult.model,
        tokensIn: classifyResult.usage.tokensIn + draftResult.usage.tokensIn,
        tokensOut: classifyResult.usage.tokensOut + draftResult.usage.tokensOut,
        latencyMs: Math.round(classifyResult.latencyMs + draftResult.latencyMs),
      },
    });
  }
}
