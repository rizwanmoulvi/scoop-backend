const { createXpSocialAdapter } = require("../adapters/xpSocialAdapter");
const { createXAdapter } = require("../adapters/xAdapter");
const { logBotActivity } = require("./botActivity");

async function postMarketResultToSocials({ prisma, market }) {
  if (!market.resultPost) {
    return {
      posted: false,
      reason: "No resultPost found",
    };
  }

  if (market.xpSocialPostId && !market.xpSocialResultPosted) {
    const adapter = createXpSocialAdapter();

    const result = await adapter.replyToPost({
      postId: market.xpSocialPostId,
      replyText: market.resultPost,
    });

    await prisma.market.update({
      where: {
        id: market.id,
      },
      data: {
        xpSocialResultPosted: true,
        xpSocialResultReplyId: result.replyId,
      },
    });

    await logBotActivity(
      prisma,
      "XP_SOCIAL_RESULT_POSTED",
      `Result posted to XP Social for Market #${market.marketNumber}`,
      {
        marketId: market.id,
        marketNumber: market.marketNumber,
        xpSocialPostId: market.xpSocialPostId,
        replyId: result.replyId,
        url: result.url,
        resultPost: market.resultPost,
      }
    );

    const xResult = await safePostResultToX({ prisma, market });

    return {
      posted: true,
      platform: "XP_SOCIAL",
      replyId: result.replyId,
      url: result.url,
      xResult,
    };
  }

  const xResult = await safePostResultToX({ prisma, market });

  if (xResult?.posted) {
    return xResult;
  }

  return {
    posted: false,
    reason: "No XP Social post found or result already posted",
  };
}

async function safePostResultToX({ prisma, market }) {
  try {
    return await postResultToXIfEnabled({ prisma, market });
  } catch (error) {
    await logBotActivity(
      prisma,
      "X_RESULT_POST_FAILED",
      `Result failed to post to X for Market #${market.marketNumber}`,
      {
        marketId: market.id,
        marketNumber: market.marketNumber,
        xPostId: market.xPostId,
        error: error.message,
      },
    );

    return {
      posted: false,
      platform: "X",
      reason: error.message,
    };
  }
}

async function postResultToXIfEnabled({ prisma, market }) {
  if (process.env.X_BOT_ENABLED !== "true" || !market.xPostId) {
    return {
      posted: false,
      platform: "X",
      reason: "X disabled or no X post found",
    };
  }

  const existing = await prisma.botActivity.findFirst({
    where: {
      type: "X_RESULT_POSTED",
      metadata: {
        path: ["marketId"],
        equals: market.id,
      },
    },
  });

  if (existing) {
    return {
      posted: false,
      platform: "X",
      reason: "X result already posted",
    };
  }

  const adapter = createXAdapter();
  const result = await adapter.replyToPost({
    postId: market.xPostId,
    replyText: market.resultPost,
  });

  await logBotActivity(
    prisma,
    "X_RESULT_POSTED",
    `Result posted to X for Market #${market.marketNumber}`,
    {
      marketId: market.id,
      marketNumber: market.marketNumber,
      xPostId: market.xPostId,
      replyId: result.replyId,
      url: result.url,
      resultPost: market.resultPost,
    },
  );

  return {
    posted: true,
    platform: "X",
    replyId: result.replyId,
    url: result.url,
  };
}

module.exports = {
  postMarketResultToSocials,
};
