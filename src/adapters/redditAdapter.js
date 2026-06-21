const { PLATFORMS } = require("../utils/platform");

function createRedditAdapter() {
  return {
    platform: PLATFORMS.REDDIT,

    async postMarket({ market, redditPost }) {
      const mockPostId = market.redditPostId || `reddit_post_${market.marketNumber}`;
      const subreddit = market.redditSubreddit || "CryptoCurrency";

      return {
        platform: PLATFORMS.REDDIT,
        success: true,
        postId: mockPostId,
        subreddit,
        url: `https://www.reddit.com/r/${subreddit}/comments/${mockPostId}`,
        title: redditPost.title,
        body: redditPost.body,
        raw: {
          mock: true,
        },
      };
    },

    async replyToComment({ commentId, replyText }) {
      const mockReplyId = `reddit_reply_${Date.now()}`;

      return {
        platform: PLATFORMS.REDDIT,
        success: true,
        replyId: mockReplyId,
        parentCommentId: commentId,
        url: `https://www.reddit.com/comments/${mockReplyId}`,
        text: replyText,
        raw: {
          mock: true,
        },
      };
    },

    async fetchComments({ market }) {
      return {
        platform: PLATFORMS.REDDIT,
        success: true,
        comments: [],
        marketId: market.id,
        postId: market.redditPostId,
        raw: {
          mock: true,
        },
      };
    },
  };
}

module.exports = {
  createRedditAdapter,
};