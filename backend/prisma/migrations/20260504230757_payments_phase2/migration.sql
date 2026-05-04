-- CreateEnum
CREATE TYPE "ApprovalKind" AS ENUM ('REPLY', 'PAYMENT_REQUEST', 'RECAP');

-- AlterTable
ALTER TABLE "ApprovalQueue" ADD COLUMN     "kind" "ApprovalKind" NOT NULL DEFAULT 'REPLY',
ADD COLUMN     "sessionId" TEXT;

-- CreateIndex
CREATE INDEX "ApprovalQueue_sessionId_idx" ON "ApprovalQueue"("sessionId");

-- AddForeignKey
ALTER TABLE "ApprovalQueue" ADD CONSTRAINT "ApprovalQueue_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
