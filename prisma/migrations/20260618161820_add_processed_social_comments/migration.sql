-- CreateTable
CREATE TABLE "ProcessedSocialComment" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "platformCommentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "replied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedSocialComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedSocialComment_platform_platformCommentId_key" ON "ProcessedSocialComment"("platform", "platformCommentId");
