const axios = require("axios");
const { PLATFORMS } = require("../utils/platform");

function createXpSocialAdapter() {
  const client = axios.create({
    baseURL: process.env.XP_SOCIAL_API_URL || "http://localhost:6000",
    headers: {
      "x-bot-api-key": process.env.XP_SOCIAL_BOT_API_KEY || "dev-bot-key-123",
    },
  });

  return {
    platform: PLATFORMS.XP_SOCIAL,

    async postMarket({ market, postText }) {
      const res = await client.post("/bot/posts", {
        content: postText,
      });

      return {
        platform: PLATFORMS.XP_SOCIAL,
        success: true,
        postId: res.data.post.id,
        url: `http://localhost:5174/post/${res.data.post.id}`,
        text: res.data.post.content,
        raw: res.data,
      };
    },

    async fetchComments({ market }) {
      if (!market.xpSocialPostId) {
        return {
          platform: PLATFORMS.XP_SOCIAL,
          success: true,
          comments: [],
        };
      }

      const res = await client.get(
        `/bot/posts/${market.xpSocialPostId}/comments`
      );

      const comments = res.data.comments.map((comment) => ({
        platform: PLATFORMS.XP_SOCIAL,
        platformUserId: comment.author.id,
        username: comment.author.username,
        platformPostId: market.xpSocialPostId,
        platformCommentId: comment.id,
        text: comment.content,
        raw: comment,
      }));

      return {
        platform: PLATFORMS.XP_SOCIAL,
        success: true,
        comments,
        raw: res.data,
      };
    },

    async replyToComment({ commentId, replyText }) {
      const res = await client.post(`/bot/posts/${commentId}/replies`, {
        content: replyText,
      });

      return {
        platform: PLATFORMS.XP_SOCIAL,
        success: true,
        replyId: res.data.reply.id,
        parentCommentId: commentId,
        url: `http://localhost:5174/post/${res.data.reply.threadRootId}`,
        text: res.data.reply.content,
        raw: res.data,
      };
    },

    async replyToPost({ postId, replyText }) {
      const res = await client.post(`/bot/posts/${postId}/replies`, {
        content: replyText,
      });

      return {
        platform: PLATFORMS.XP_SOCIAL,
        success: true,
        replyId: res.data.reply.id,
        parentPostId: postId,
        url: `http://localhost:5174/post/${res.data.reply.threadRootId}`,
        text: res.data.reply.content,
        raw: res.data,
      };
    },
  };
}

module.exports = {
  createXpSocialAdapter,
};