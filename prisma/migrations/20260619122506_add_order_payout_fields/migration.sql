-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "payoutAmountRaw" TEXT,
ADD COLUMN     "payoutStatus" TEXT NOT NULL DEFAULT 'NOT_PAID',
ADD COLUMN     "payoutTxDigest" TEXT;
