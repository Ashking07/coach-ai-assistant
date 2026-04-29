import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DashboardService } from '../dashboard/dashboard.service';
import { CoachCommandProposal, StoredProposal } from './coach-command.types';
import { OBS_EMITTER, type ObsEmitterPort } from '../observability/observability.constants';
import { traceRun, traceStep } from '../observability/trace-step';

const PROPOSAL_TTL_MS = 60 * 1000;

@Injectable()
export class CoachCommandService {
  private readonly logger = new Logger(CoachCommandService.name);
  private readonly proposals = new Map<string, StoredProposal>();

  constructor(
    private readonly dashboard: DashboardService,
    @Inject(OBS_EMITTER) private readonly obs: ObsEmitterPort,
  ) {}

  storeProposal(coachId: string, proposal: CoachCommandProposal): StoredProposal {
    const id = `prop_${randomUUID()}`;
    const now = new Date();
    const stored: StoredProposal = {
      id,
      coachId,
      proposal,
      createdAt: now,
      expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS),
    };
    this.proposals.set(id, stored);
    this.logger.log({ event: 'PROPOSAL_STORED', id, coachId, kind: proposal.kind });
    return stored;
  }

  getProposal(id: string, coachId: string): StoredProposal | null {
    const stored = this.proposals.get(id);
    if (!stored) return null;
    if (stored.coachId !== coachId) return null;
    if (stored.expiresAt.getTime() <= Date.now()) {
      this.proposals.delete(id);
      return null;
    }
    return stored;
  }

  async confirm(id: string, coachId: string): Promise<void> {
    const stored = this.getProposal(id, coachId);
    if (!stored) {
      throw new NotFoundException('Proposal not found or expired');
    }
    await traceRun(
      this.obs,
      {
        runbook: 'voice.confirm_proposal',
        input: { proposalId: id, kind: stored.proposal.kind },
      },
      async (ctx) => {
        await traceStep(
          this.obs,
          ctx,
          'dispatch',
          `voice.${stored.proposal.kind.toLowerCase()}`,
          { kind: stored.proposal.kind },
          () => this.dispatch(coachId, stored.proposal),
        );
      },
    );
    this.proposals.delete(id);
    this.logger.log({
      event: 'PROPOSAL_CONFIRMED',
      id,
      coachId,
      kind: stored.proposal.kind,
    });
  }

  cancel(id: string, coachId: string): void {
    const stored = this.getProposal(id, coachId);
    if (!stored) return;
    this.proposals.delete(id);
    this.logger.log({ event: 'PROPOSAL_CANCELLED', id, coachId });
  }

  private async dispatch(
    coachId: string,
    proposal: CoachCommandProposal,
  ): Promise<void> {
    switch (proposal.kind) {
      case 'APPROVE_PENDING':
        await this.dashboard.sendApproval(coachId, proposal.approvalId);
        return;
      case 'DISMISS_PENDING':
        await this.dashboard.dismissApproval(coachId, proposal.approvalId);
        return;
      case 'BLOCK_AVAILABILITY':
        await this.dashboard.addAvailability(coachId, proposal.startAtIso, proposal.endAtIso, true);
        return;
      case 'CANCEL_SESSION':
        await this.dashboard.cancelSession(coachId, proposal.sessionId);
        return;
      case 'SCHEDULE_SESSION':
        await this.dashboard.scheduleSession(coachId, proposal.kidId, proposal.startAtIso);
        return;
      case 'ADD_AVAILABILITY':
        await this.dashboard.addAvailability(coachId, proposal.startAtIso, proposal.endAtIso, false);
        return;
      case 'DRAFT_REPLY':
        await this.dashboard.sendDraftedReply(coachId, {
          parentName: proposal.parentName,
          body: proposal.messageBody,
        });
        return;
    }
  }
}
