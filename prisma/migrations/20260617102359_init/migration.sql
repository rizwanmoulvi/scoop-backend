-- CreateEnum
CREATE TYPE "MarketStatus" AS ENUM ('OPEN', 'EXPIRED', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Outcome" AS ENUM ('YES', 'NO');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PLACED', 'WON', 'LOST', 'REFUNDED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "xUserId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "demoBalance" DECIMAL(65,30) NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL,
    "marketNumber" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "targetPrice" DECIMAL(65,30) NOT NULL,
    "expiryTime" TIMESTAMP(3) NOT NULL,
    "yesPrice" DECIMAL(65,30) NOT NULL,
    "noPrice" DECIMAL(65,30) NOT NULL,
    "status" "MarketStatus" NOT NULL DEFAULT 'OPEN',
    "result" "Outcome",
    "xPostId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "side" "Outcome" NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "entryPrice" DECIMAL(65,30) NOT NULL,
    "potentialPayout" DECIMAL(65,30) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PLACED',
    "sourceCommentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_xUserId_key" ON "User"("xUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Market_marketNumber_key" ON "Market"("marketNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Market_xPostId_key" ON "Market"("xPostId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_sourceCommentId_key" ON "Order"("sourceCommentId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
