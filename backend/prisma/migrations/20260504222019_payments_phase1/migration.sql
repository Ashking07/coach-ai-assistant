-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'REFUNDED', 'FAILED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentMethod" ADD VALUE 'VENMO';
ALTER TYPE "PaymentMethod" ADD VALUE 'ZELLE';
ALTER TYPE "PaymentMethod" ADD VALUE 'CHECK';
ALTER TYPE "PaymentMethod" ADD VALUE 'OTHER';

-- AlterTable
ALTER TABLE "Coach" ADD COLUMN     "defaultRateCents" INTEGER NOT NULL DEFAULT 8000,
ADD COLUMN     "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeOnboardingDone" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Kid" ADD COLUMN     "rateCentsOverride" INTEGER;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "priceCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "stripeCheckoutId" TEXT,
    "stripePaymentIntent" TEXT,
    "stripeEventId" TEXT,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripeCheckoutId_key" ON "Payment"("stripeCheckoutId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripePaymentIntent_key" ON "Payment"("stripePaymentIntent");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripeEventId_key" ON "Payment"("stripeEventId");

-- CreateIndex
CREATE INDEX "Payment_coachId_createdAt_idx" ON "Payment"("coachId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_sessionId_idx" ON "Payment"("sessionId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
