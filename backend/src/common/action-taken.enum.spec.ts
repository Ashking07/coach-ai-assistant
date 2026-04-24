import { ActionTaken } from '@prisma/client';

describe('ActionTaken enum', () => {
  it('includes all runtime action values plus delivery failure', () => {
    const values = Object.values(ActionTaken);

    expect(values).toEqual(
      expect.arrayContaining([
        'AUTO_SENT',
        'QUEUED_FOR_APPROVAL',
        'ESCALATED',
        'CLASSIFY_FAILED',
        'DRAFT_FAILED',
        'SEND_FAILED',
        'DELIVERY_FAILED',
      ]),
    );
  });
});
