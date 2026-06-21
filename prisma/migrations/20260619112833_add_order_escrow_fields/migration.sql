-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "escrowAddress" TEXT,
ADD COLUMN     "escrowTxDigest" TEXT,
ADD COLUMN     "escrowedAmountRaw" TEXT,
ADD COLUMN     "fundingStatus" TEXT NOT NULL DEFAULT 'NOT_FUNDED';
