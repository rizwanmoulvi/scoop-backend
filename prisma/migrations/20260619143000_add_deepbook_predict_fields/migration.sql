-- Add DeepBook Predict integration metadata while preserving the existing
-- XPredict escrow/demo columns for fallback operation.

ALTER TABLE "User"
ADD COLUMN "predictManagerId" TEXT;

ALTER TABLE "Market"
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'XPREDICT',
ADD COLUMN "predictOracleId" TEXT,
ADD COLUMN "predictExpiry" TIMESTAMP(3),
ADD COLUMN "predictStrike" DECIMAL(65,30),
ADD COLUMN "predictDirection" TEXT,
ADD COLUMN "predictMarketType" TEXT,
ADD COLUMN "predictMarketKeyJson" JSONB,
ADD COLUMN "predictServerPayload" JSONB,
ADD COLUMN "botPostedAt" TIMESTAMP(3),
ADD COLUMN "botPostReason" TEXT,
ADD COLUMN "oracleStatus" TEXT,
ADD COLUMN "settlementStatus" TEXT;

CREATE UNIQUE INDEX "Market_predictOracleId_predictStrike_predictDirection_key"
ON "Market"("predictOracleId", "predictStrike", "predictDirection");

ALTER TABLE "Order"
ADD COLUMN "predictManagerId" TEXT,
ADD COLUMN "predictOracleId" TEXT,
ADD COLUMN "predictExpiry" TIMESTAMP(3),
ADD COLUMN "predictStrike" DECIMAL(65,30),
ADD COLUMN "predictDirection" TEXT,
ADD COLUMN "predictMarketKeyJson" JSONB,
ADD COLUMN "predictMintDigest" TEXT,
ADD COLUMN "predictRedeemDigest" TEXT,
ADD COLUMN "predictQuantity" TEXT,
ADD COLUMN "predictExecutionStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN "predictRedeemStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED';
