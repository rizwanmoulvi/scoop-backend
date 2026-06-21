const cron = require("node-cron");
const { createXpSocialAdapter } = require("../adapters/xpSocialAdapter");
const { handleSocialComment } = require("../services/handleSocialComment");
const { logBotActivity } = require("../services/botActivity");
const { PLATFORMS } = require("../utils/platform");
const { isSystemPaused } = require("../services/systemControl");

function startXpSocialCommentWorker(prisma) {
  const adapter = createXpSocialAdapter();

  cron.schedule("*/5 * * * * *", async () => {
    if (isSystemPaused()) {
      return;
    }

    try {
      const markets = await prisma.market.findMany({
        where: {
          status: "OPEN",
          xpSocialPostId: {
            not: null,
          },
        },
      });

      for (const market of markets) {
        const fetched = await adapter.fetchComments({ market });

        for (const comment of fetched.comments) {
          const processingRecord = await claimCommentForProcessing({
            prisma,
            platformCommentId: comment.platformCommentId,
          });

          if (!processingRecord) {
            continue;
          }

          let result;
          let replied = false;

          try {
            result = await handleSocialComment({
              prisma,
              platform: PLATFORMS.XP_SOCIAL,
              platformUserId: comment.platformUserId,
              username: comment.username,
              platformPostId: comment.platformPostId,
              platformCommentId: comment.platformCommentId,
              text: comment.text,
            });

            if (result.reply) {
              await adapter.replyToComment({
                commentId: comment.platformCommentId,
                replyText: result.reply,
              });

              replied = true;

              await logBotActivity(
                prisma,
                "XP_SOCIAL_REPLY_POSTED",
                `XP Social reply posted for @${comment.username}`,
                {
                  marketId: market.id,
                  marketNumber: market.marketNumber,
                  commentId: comment.platformCommentId,
                  reply: result.reply,
                }
              );
            }

            await prisma.processedSocialComment.update({
              where: {
                id: processingRecord.id,
              },
              data: {
                status: result.status || "UNKNOWN",
                replied,
              },
            });
          } catch (error) {
            await prisma.processedSocialComment.update({
              where: {
                id: processingRecord.id,
              },
              data: {
                status: "ERROR",
                replied,
              },
            });

            throw error;
          }
        }
      }
    } catch (error) {
      console.error("XP Social comment worker error:", error.message);

      await logBotActivity(
        prisma,
        "XP_SOCIAL_WORKER_ERROR",
        "XP Social comment worker failed",
        {
          error: error.message,
        }
      );
    }
  });

  console.log("XP Social comment worker started");
}

async function claimCommentForProcessing({ prisma, platformCommentId }) {
  try {
    return await prisma.processedSocialComment.create({
      data: {
        platform: PLATFORMS.XP_SOCIAL,
        platformCommentId,
        status: "PROCESSING",
        replied: false,
      },
    });
  } catch (error) {
    if (error.code === "P2002") {
      return null;
    }

    throw error;
  }
}

module.exports = {
  startXpSocialCommentWorker,
};
