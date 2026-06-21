/*
  Warnings:

  - A unique constraint covering the columns `[xpSocialPostId]` on the table `Market` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Market" ADD COLUMN     "xpSocialPostId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Market_xpSocialPostId_key" ON "Market"("xpSocialPostId");
