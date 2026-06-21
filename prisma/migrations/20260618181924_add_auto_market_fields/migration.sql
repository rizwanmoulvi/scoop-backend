-- AlterTable
ALTER TABLE "Market" ADD COLUMN     "marketType" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "referencePrice" DECIMAL(65,30);
