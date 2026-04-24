-- Step 1: create ActionTaken enum
CREATE TYPE "ActionTaken" AS ENUM (
  'AUTO_SENT',
  'QUEUED_FOR_APPROVAL',
  'ESCALATED',
  'CLASSIFY_FAILED',
  'DRAFT_FAILED',
  'SEND_FAILED',
  'DELIVERY_FAILED'
);

-- Step 2: cast AgentDecision.actionTaken from text to ActionTaken
ALTER TABLE "AgentDecision"
ALTER COLUMN "actionTaken" TYPE "ActionTaken"
USING ("actionTaken"::"ActionTaken");
