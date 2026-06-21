const cron = require("node-cron");
const { createXAdapter } = require("../adapters/xAdapter");
const { handleSocialComment } = require("../services/handleSocialComment");
const { logBotActivity } = require("../services/botActivity");
const { PLATFORMS } = require("../utils/platform");
const { isSystemPaused } = require("../services/systemControl");

function startXCommentWorker(prisma) {
  if (process.env.X_BOT_ENABLED !== "true") {
    console.log("X comment worker disabled");
    return;
  }

  const adapter = createXAdapter();
  const intervalSeconds = Number(process.env.X_COMMENT_POLL_INTERVAL_SECONDS || 30);

  cron.schedule(`*/${intervalSeconds} * * * * *`, async () => {
    if (isSystemPaused()) {
      return;
    }

    try {
      const markets = await prisma.market.findMany({
        where: {
          status: "OPEN",
          xPostId: {
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
              platform: PLATFORMS.X,
              platformUserId: comment.platformUserId,
              username: comment.username,
              platformPostId: comment.platformPostId,
              platformCommentId: comment.platformCommentId,
              text: normalizeXReplyText(comment.text),
            });

            if (result.reply) {
              try {
                await adapter.replyToComment({
                  commentId: comment.platformCommentId,
                  replyText: result.reply,
                });

                replied = true;

                await logBotActivity(
                  prisma,
                  "X_REPLY_POSTED",
                  `X reply posted for @${comment.username}`,
                  {
                    marketId: market.id,
                    marketNumber: market.marketNumber,
                    commentId: comment.platformCommentId,
                    reply: result.reply,
                  },
                );
              } catch (replyError) {
                await logBotActivity(
                  prisma,
                  "X_REPLY_FAILED",
                  `X reply failed for @${comment.username}`,
                  {
                    marketId: market.id,
                    marketNumber: market.marketNumber,
                    commentId: comment.platformCommentId,
                    status: replyError.response?.status,
                    error: replyError.message,
                    response: replyError.response?.data,
                    reply: result.reply,
                  },
                );
              }
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
      console.error("X comment worker error:", error.message);

      await logBotActivity(
        prisma,
        "X_WORKER_ERROR",
        "X comment worker failed",
        {
          error: error.message,
        },
      );
    }
  });

  console.log("X comment worker started");
}

function normalizeXReplyText(text) {
  return String(text || "")
    .replace(/^(@[A-Za-z0-9_]{1,15}\s*)+/, "")
    .trim();
}

async function claimCommentForProcessing({ prisma, platformCommentId }) {
  try {
    return await prisma.processedSocialComment.create({
      data: {
        platform: PLATFORMS.X,
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
  startXCommentWorker,
};
