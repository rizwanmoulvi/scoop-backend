/*
  Warnings:

  - You are about to drop the column `xUserId` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[redditPostId]` on the table `Market` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[sourcePlatform,sourceCommentId]` on the table `Order` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[platform,platformUserId]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[platform,username]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `sourcePlatform` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Made the column `sourceCommentId` on table `Order` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `platform` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `platformUserId` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('X', 'REDDIT');

-- DropIndex
DROP INDEX "Order_sourceCommentId_key";

-- DropIndex
DROP INDEX "User_username_key";

-- DropIndex
DROP INDEX "User_xUserId_key";

-- AlterTable
ALTER TABLE "Market" ADD COLUMN     "redditPostId" TEXT,
ADD COLUMN     "redditSubreddit" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "sourcePlatform" "Platform" NOT NULL,
ADD COLUMN     "sourcePostId" TEXT,
ALTER COLUMN "sourceCommentId" SET NOT NULL;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "xUserId",
ADD COLUMN     "platform" "Platform" NOT NULL,
ADD COLUMN     "platformUserId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Market_redditPostId_key" ON "Market"("redditPostId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_sourcePlatform_sourceCommentId_key" ON "Order"("sourcePlatform", "sourceCommentId");

-- CreateIndex
CREATE UNIQUE INDEX "User_platform_platformUserId_key" ON "User"("platform", "platformUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_platform_username_key" ON "User"("platform", "username");
