import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../prisma.service';
import { TEST_JOB_QUEUE } from '../../bullmq.module';
import { MESSAGE_INGESTED_JOB } from '../../bullmq.constants';
import type { ParentMessage } from '@coach/shared';
import { ClassifyIntentState } from '../agent/states/classify-intent.state';
import { LoadContextState } from '../agent/states/load-context.state';
import { PolicyGate } from '../agent/gates/policy-gate';
import { ConfidenceGate } from '../agent/gates/confidence-gate';
import { DraftReplyState } from '../agent/states/draft-reply.state';
import { OutboundService } from '../agent/outbound/outbound.service';
import { validateDraft } from '../agent/states/validate-draft.state';
import { ConfidenceTier } from '@prisma/client';

export type IngestResult =
  | { messageId: string; duplicate: false; enqueued: true; jobId: string }
  | { messageId: string; duplicate: true; enqueued: false; jobId: null };

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TEST_JOB_QUEUE) private readonly queue: Queue,
    private readonly classifyIntentState: ClassifyIntentState,
    private readonly loadContextState: LoadContextState,
    private readonly policyGate: PolicyGate,
    private readonly confidenceGate: ConfidenceGate,
    private readonly draftReplyState: DraftReplyState,
    private readonly outboundService: OutboundService,
  ) {}

  async ingest(msg: ParentMessage): Promise<IngestResult> {
    const parentAlreadyExists = await this.prisma.parent.findUnique({
      where: { coachId_phone: { coachId: msg.coachId, phone: msg.fromPhone } },
      select: { id: true },
    });

    const isWebChat = msg.channel === 'WEB_CHAT';
    const parent = await this.prisma.parent.upsert({
      where: { coachId_phone: { coachId: msg.coachId, phone: msg.fromPhone } },
      create: {
        coachId: msg.coachId,
        phone: msg.fromPhone,
        name: msg.fromName ?? `Unknown (${msg.fromPhone})`,
        preferredChannel: msg.channel === 'VOICE' ? 'SMS' : msg.channel,
        isVerified: isWebChat,
      },
      update: isWebChat ? { isVerified: true } : {},
    });

    if (!parentAlreadyExists) {
      this.logger.log(
        {
          event: 'UNKNOWN_PARENT_CREATED',
          coachId: msg.coachId,
          parentId: parent.id,
          phone: msg.fromPhone,
          channel: msg.channel,
        },
        MessagesService.name,
      );
    }

    const existing = await this.prisma.message.findUnique({
      where: {
        channel_providerMessageId: {
          channel: msg.channel,
          providerMessageId: msg.providerMessageId,
        },
      },
      select: { id: true },
    });
    if (existing) {
      this.logger.warn(
        {
          event: 'DUPLICATE_MESSAGE_DROPPED',
          messageId: existing.id,
          channel: msg.channel,
          providerMessageId: msg.providerMessageId,
        },
        MessagesService.name,
      );
      return {
        messageId: existing.id,
        duplicate: true,
        enqueued: false,
        jobId: null,
      };
    }

    const message = await this.prisma.message.create({
      data: {
        coachId: msg.coachId,
        parentId: parent.id,
        direction: 'INBOUND',
        channel: msg.channel,
        providerMessageId: msg.providerMessageId,
        content: msg.content,
        receivedAt: msg.receivedAt,
      },
    });

    const job = await this.queue.add(MESSAGE_INGESTED_JOB, {
      messageId: message.id,
    });

    return {
      messageId: message.id,
      duplicate: false,
      enqueued: true,
      jobId: String(job.id),
    };
  }

  async recoverOrphanedMessages(): Promise<number> {
    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const orphans = await this.prisma.message.findMany({
      where: {
        direction: 'INBOUND',
        receivedAt: { gte: sinceIso },
        agentDecisions: { none: {} },
      },
      select: { id: true, receivedAt: true },
    });
    for (const o of orphans) {
      await this.queue.add(MESSAGE_INGESTED_JOB, { messageId: o.id });
      this.logger.log(
        {
          event: 'ORPHAN_MESSAGE_REENQUEUED',
          messageId: o.id,
          ageSeconds: Math.round((Date.now() - o.receivedAt.getTime()) / 1000),
        },
        MessagesService.name,
      );
    }
    return orphans.length;
  }

  async processIngestedMessage(messageId: string): Promise<boolean> {
    const existing = await this.prisma.agentDecision.findFirst({
      where: { messageId },
      select: { id: true },
    });
    if (existing) {
      return false;
    }

    const message = await this.prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      include: { parent: true },
    });

    const markProcessed = () =>
      this.prisma.message.update({
        where: { id: message.id },
        data: { processedAt: new Date() },
      });

    // Stage 1: classify
    let classifyResult: Awaited<
      ReturnType<ClassifyIntentState['classifyIntent']>
    >;
    try {
      classifyResult = await this.classifyIntentState.classifyIntent({
        messageId: message.id,
        content: message.content,
        parentKnown: message.parent.isVerified,
      });
    } catch (error) {
      await this.outboundService.escalate({
        coachId: message.coachId,
        messageId: message.id,
        reason: this.formatError(error),
        actionTaken: 'CLASSIFY_FAILED',
        classifyResult: undefined,
      });
      await markProcessed();
      return true;
    }

    // Stage 2: load context
    const context = await this.loadContextState.loadContext(
      message.parentId,
      message.coachId,
    );

    // Stage 3: policy gate
    const policyViolation = this.policyGate.check({
      intent: classifyResult.intent,
      content: message.content,
      parentKnown: message.parent.isVerified,
    });
    if (policyViolation) {
      await this.outboundService.escalate({
        coachId: message.coachId,
        messageId: message.id,
        reason: policyViolation.reason,
        actionTaken: 'ESCALATED',
        classifyResult,
      });
      await markProcessed();
      return true;
    }

    // Stage 4: confidence gate
    let tier = this.confidenceGate.determine({
      intent: classifyResult.intent,
      confidence: classifyResult.confidence,
      parentKnown: message.parent.isVerified,
      hasAvailableSlots: context.availableSlots.length > 0,
    });

    // Stage 5: draft
    let draftResult: Awaited<ReturnType<DraftReplyState['draft']>>;
    try {
      draftResult = await this.draftReplyState.draft({
        message,
        intent: classifyResult.intent,
        tier,
        context,
      });
    } catch (error) {
      await this.outboundService.escalate({
        coachId: message.coachId,
        messageId: message.id,
        reason: this.formatError(error),
        actionTaken: 'DRAFT_FAILED',
        classifyResult,
      });
      await markProcessed();
      return true;
    }

    // Stage 6: validate draft (hallucination backstop)
    const validation = validateDraft({
      draft: draftResult.draft,
      availableSlots: context.availableSlots,
      tier,
      intent: classifyResult.intent,
    });
    if (validation.downgraded) {
      tier = validation.tier;
    }

    // Stage 7: send
    const outboundParams = {
      coachId: message.coachId,
      messageId: message.id,
      parentId: message.parentId,
      channel: message.parent.preferredChannel,
      classifyResult,
      draftResult,
    };
    try {
      if (tier === ConfidenceTier.AUTO) {
        await this.outboundService.autoSend(outboundParams);
      } else {
        await this.outboundService.queueForApproval(outboundParams);
      }
    } catch (error) {
      await this.outboundService.escalate({
        coachId: message.coachId,
        messageId: message.id,
        reason: this.formatError(error),
        actionTaken: 'SEND_FAILED',
        classifyResult,
      });
    }

    await markProcessed();
    return true;
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`.slice(0, 1000);
    }
    return 'Unknown error';
  }
}
