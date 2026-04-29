import { Test } from '@nestjs/testing';
import { CoachCommandService } from './coach-command.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { NoopObsEmitter } from '../observability/noop-emitter';
import { OBS_EMITTER } from '../observability/observability.constants';

describe('CoachCommandService', () => {
  let service: CoachCommandService;
  let dashboard: jest.Mocked<DashboardService>;

  beforeEach(async () => {
    dashboard = {
      sendApproval: jest.fn().mockResolvedValue(undefined),
      dismissApproval: jest.fn().mockResolvedValue(undefined),
      addAvailability: jest.fn().mockResolvedValue(undefined),
      cancelSession: jest.fn().mockResolvedValue(undefined),
      sendDraftedReply: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DashboardService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        CoachCommandService,
        { provide: DashboardService, useValue: dashboard },
        { provide: OBS_EMITTER, useValue: new NoopObsEmitter() },
      ],
    }).compile();
    service = moduleRef.get(CoachCommandService);
  });

  it('stores a proposal and returns an id', () => {
    const stored = service.storeProposal('coach_1', {
      kind: 'APPROVE_PENDING',
      approvalId: 'a1',
      summary: 'Approve reply',
    });
    expect(stored.id).toMatch(/^prop_/);
    expect(service.getProposal(stored.id, 'coach_1')).toEqual(stored);
  });

  it('rejects proposal lookup with mismatched coachId', () => {
    const stored = service.storeProposal('coach_1', {
      kind: 'APPROVE_PENDING',
      approvalId: 'a1',
      summary: 's',
    });
    expect(service.getProposal(stored.id, 'coach_other')).toBeNull();
  });

  it('expires a proposal after 60s', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-25T10:00:00Z'));
    const stored = service.storeProposal('coach_1', {
      kind: 'APPROVE_PENDING',
      approvalId: 'a1',
      summary: 's',
    });
    jest.setSystemTime(new Date('2026-04-25T10:01:01Z'));
    expect(service.getProposal(stored.id, 'coach_1')).toBeNull();
    jest.useRealTimers();
  });

  it('dispatches APPROVE_PENDING to dashboard.sendApproval', async () => {
    const stored = service.storeProposal('coach_1', {
      kind: 'APPROVE_PENDING',
      approvalId: 'a1',
      summary: 's',
    });
    await service.confirm(stored.id, 'coach_1');
    expect(dashboard.sendApproval).toHaveBeenCalledWith('coach_1', 'a1');
  });

  it('dispatches DISMISS_PENDING to dashboard.dismissApproval', async () => {
    const stored = service.storeProposal('coach_1', {
      kind: 'DISMISS_PENDING',
      approvalId: 'a2',
      summary: 's',
    });
    await service.confirm(stored.id, 'coach_1');
    expect(dashboard.dismissApproval).toHaveBeenCalledWith('coach_1', 'a2');
  });

  it('dispatches BLOCK_AVAILABILITY to dashboard.addAvailability with isBlocked', async () => {
    const stored = service.storeProposal('coach_1', {
      kind: 'BLOCK_AVAILABILITY',
      startAtIso: '2026-04-26T18:00:00.000Z',
      endAtIso: '2026-04-26T19:00:00.000Z',
      summary: 'Block 6pm',
    });
    await service.confirm(stored.id, 'coach_1');
    expect(dashboard.addAvailability).toHaveBeenCalled();
  });

  it('dispatches CANCEL_SESSION to dashboard.cancelSession', async () => {
    const stored = service.storeProposal('coach_1', {
      kind: 'CANCEL_SESSION',
      sessionId: 'sess_5',
      summary: 'Cancel 4pm',
    });
    await service.confirm(stored.id, 'coach_1');
    expect(dashboard.cancelSession).toHaveBeenCalledWith('coach_1', 'sess_5');
  });

  it('dispatches DRAFT_REPLY to dashboard.sendDraftedReply', async () => {
    const stored = service.storeProposal('coach_1', {
      kind: 'DRAFT_REPLY',
      parentName: 'Priya',
      messageBody: 'On my way',
      summary: 'Reply to Priya',
    });
    await service.confirm(stored.id, 'coach_1');
    expect(dashboard.sendDraftedReply).toHaveBeenCalledWith('coach_1', {
      parentName: 'Priya',
      body: 'On my way',
    });
  });

  it('throws on confirm of unknown id', async () => {
    await expect(service.confirm('prop_nope', 'coach_1')).rejects.toThrow(
      /not found/i,
    );
  });

  it('removes a proposal after confirm', async () => {
    const stored = service.storeProposal('coach_1', {
      kind: 'APPROVE_PENDING',
      approvalId: 'a1',
      summary: 's',
    });
    await service.confirm(stored.id, 'coach_1');
    expect(service.getProposal(stored.id, 'coach_1')).toBeNull();
  });
});
