-- AlterEnum
ALTER TYPE "ActionTaken" ADD VALUE 'SKIPPED_AGENT_PAUSED';

-- AlterTable
ALTER TABLE "Coach" ADD COLUMN     "agentPaused" BOOLEAN NOT NULL DEFAULT false;
