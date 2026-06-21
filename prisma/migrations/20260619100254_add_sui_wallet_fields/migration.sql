/*
  Warnings:

  - A unique constraint covering the columns `[suiAddress]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "cryptoWalletCreated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "suiAddress" TEXT,
ADD COLUMN     "suiPrivateKey" TEXT,
ADD COLUMN     "suiPublicKey" TEXT,
ADD COLUMN     "walletProvider" TEXT NOT NULL DEFAULT 'BACKEND_CUSTODIAL_TESTNET';

-- CreateIndex
CREATE UNIQUE INDEX "User_suiAddress_key" ON "User"("suiAddress");
