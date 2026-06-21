const { createXAdapter } = require("../adapters/xAdapter");
const { createRedditAdapter } = require("../adapters/redditAdapter");
const { generateMarketPost } = require("../utils/generateMarketPost");
const { generateRedditPost } = require("../utils/generateRedditPost");
const {
  generateDeepbookPredictPost,
} = require("../utils/generateDeepbookPredictPost");
const { logBotActivity } = require("./botActivity");
const { PLATFORMS } = require("../utils/platform");
const { createXpSocialAdapter } = require("../adapters/xpSocialAdapter");

function createSocialBotService(prisma) {
  const adapters = {
    [PLATFORMS.X]: createXAdapter(),
    [PLATFORMS.REDDIT]: createRedditAdapter(),
    [PLATFORMS.XP_SOCIAL]: createXpSocialAdapter(),
  };

  async function postResultToPlatformPost({ platform, postId, resultText }) {
    const adapter = adapters[platform];

    if (!adapter) {
      throw new Error(`No adapter found for platform ${platform}`);
    }

    if (!adapter.replyToPost) {
      throw new Error(`Adapter ${platform} does not support replyToPost`);
    }

    const result = await adapter.replyToPost({
      postId,
      replyText: resultText,
    });

    await logBotActivity(
      prisma,
      "SOCIAL_RESULT_POSTED",
      `Result posted to ${platform}`,
      {
        platform,
        postId,
        replyId: result.replyId,
        url: result.url,
        resultText,
      },
    );

    return result;
  }

  async function postMarketToPlatform({ market, platform }) {
    const adapter = adapters[platform];

    if (!adapter) {
      throw new Error(`No adapter found for platform ${platform}`);
    }

    if (platform === PLATFORMS.X) {
      const postText =
        market.source === "DEEPBOOK_PREDICT"
          ? generateDeepbookPredictPost(market)
          : generateMarketPost(market);

      const result = await adapter.postMarket({
        market,
        postText,
      });

      await prisma.market.update({
        where: {
          id: market.id,
        },
        data: {
          xPostId: result.postId,
        },
      });

      await logBotActivity(
        prisma,
        "SOCIAL_MARKET_POSTED",
        `Market #${market.marketNumber} posted to X`,
        {
          platform,
          marketId: market.id,
          marketNumber: market.marketNumber,
          postId: result.postId,
          url: result.url,
          text: result.text,
          mock: false,
        },
      );

      return result;
    }

    if (platform === PLATFORMS.REDDIT) {
      const redditPost = generateRedditPost(market);

      const result = await adapter.postMarket({
        market,
        redditPost,
      });

      await prisma.market.update({
        where: {
          id: market.id,
        },
        data: {
          redditPostId: result.postId,
          redditSubreddit: result.subreddit,
        },
      });

      await logBotActivity(
        prisma,
        "SOCIAL_MARKET_POSTED",
        `Market #${market.marketNumber} mock-posted to Reddit`,
        {
          platform,
          marketId: market.id,
          marketNumber: market.marketNumber,
          postId: result.postId,
          subreddit: result.subreddit,
          url: result.url,
          title: result.title,
          body: result.body,
          mock: true,
        },
      );

      return result;
    }

    if (platform === PLATFORMS.XP_SOCIAL) {
      const postText =
        market.source === "DEEPBOOK_PREDICT"
          ? generateDeepbookPredictPost(market)
          : generateMarketPost(market);

      const result = await adapter.postMarket({
        market,
        postText,
      });

      await prisma.market.update({
        where: {
          id: market.id,
        },
        data: {
          xpSocialPostId: result.postId,
        },
      });

      await logBotActivity(
        prisma,
        "SOCIAL_MARKET_POSTED",
        `Market #${market.marketNumber} posted to XP Social`,
        {
          platform,
          marketId: market.id,
          marketNumber: market.marketNumber,
          postId: result.postId,
          url: result.url,
          text: result.text,
          mock: false,
        },
      );

      return result;
    }

    throw new Error(`Unsupported platform ${platform}`);
  }

  async function postMarketToAllPlatforms({ market }) {
    const results = [];

    const xpSocialResult = await postMarketToPlatform({
      market,
      platform: PLATFORMS.XP_SOCIAL,
    });

    results.push(xpSocialResult);

    if (process.env.X_BOT_ENABLED === "true") {
      try {
        const xResult = await postMarketToPlatform({
          market,
          platform: PLATFORMS.X,
        });

        results.push(xResult);
      } catch (error) {
        await logBotActivity(
          prisma,
          "X_MARKET_POST_FAILED",
          `Market #${market.marketNumber} failed to post to X`,
          {
            marketId: market.id,
            marketNumber: market.marketNumber,
            error: error.message,
          },
        );
      }
    }

    return results;
  }

  async function replyToPlatformComment({ platform, commentId, replyText }) {
    const adapter = adapters[platform];

    if (!adapter) {
      throw new Error(`No adapter found for platform ${platform}`);
    }

    const result = await adapter.replyToComment({
      commentId,
      replyText,
    });

    await logBotActivity(
      prisma,
      "SOCIAL_REPLY_POSTED",
      `Reply posted to ${platform}`,
      {
        platform,
        commentId,
        replyId: result.replyId,
        url: result.url,
        replyText,
        mock: false,
      },
    );

    return result;
  }

  return {
    postMarketToPlatform,
    postMarketToAllPlatforms,
    replyToPlatformComment,
    postResultToPlatformPost,
  };
}

module.exports = {
  createSocialBotService,
};
