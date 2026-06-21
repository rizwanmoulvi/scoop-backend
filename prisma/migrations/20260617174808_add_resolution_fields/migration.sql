-- AlterTable
ALTER TABLE "Market" ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedPrice" DECIMAL(65,30),
ADD COLUMN     "resultPost" TEXT;
