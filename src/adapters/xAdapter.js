const crypto = require("crypto");
const axios = require("axios");
const { PLATFORMS } = require("../utils/platform");

const X_API_BASE_URL = "https://api.twitter.com/2";
const TWEET_LIMIT = 280;

function createXAdapter() {
  const client = axios.create({
    baseURL: process.env.X_API_BASE_URL || X_API_BASE_URL,
    timeout: Number(process.env.X_API_TIMEOUT_MS || 15000),
  });

  return {
    platform: PLATFORMS.X,

    async postMarket({ market, postText }) {
      ensureWriteCredentials();

      const tweets = splitTweetText(postText);
      let parentTweetId = null;
      let firstTweet = null;
      let lastTweet = null;

      for (const text of tweets) {
        const tweet = await createTweet({
          client,
          text,
          inReplyToTweetId: parentTweetId,
        });

        if (!firstTweet) {
          firstTweet = tweet;
        }

        lastTweet = tweet;
        parentTweetId = tweet.id;
      }

      return {
        platform: PLATFORMS.X,
        success: true,
        postId: firstTweet.id,
        lastPostId: lastTweet.id,
        url: xStatusUrl(firstTweet.id),
        text: postText,
        raw: {
          firstTweet,
          lastTweet,
          tweetCount: tweets.length,
        },
      };
    },

    async fetchComments({ market }) {
      if (!market.xPostId) {
        return {
          platform: PLATFORMS.X,
          success: true,
          comments: [],
        };
      }

      ensureReadCredentials();

      const botUsername = process.env.X_BOT_USERNAME;
      const query = botUsername
        ? `conversation_id:${market.xPostId} -from:${botUsername}`
        : `conversation_id:${market.xPostId}`;

      const res = await client.get("/tweets/search/recent", {
        params: {
          query,
          "tweet.fields":
            "author_id,conversation_id,created_at,in_reply_to_user_id,referenced_tweets",
          expansions: "author_id",
          "user.fields": "username,name",
          max_results: Number(process.env.X_FETCH_MAX_RESULTS || 25),
        },
        headers: readHeaders(),
      });

      const usersById = new Map(
        (res.data.includes?.users || []).map((user) => [user.id, user]),
      );
      const comments = (res.data.data || [])
        .filter((tweet) => tweet.id !== market.xPostId)
        .filter((tweet) => tweet.author_id !== process.env.X_BOT_USER_ID)
        .map((tweet) => {
          const author = usersById.get(tweet.author_id);

          return {
            platform: PLATFORMS.X,
            platformUserId: tweet.author_id,
            username: author?.username || tweet.author_id,
            platformPostId: market.xPostId,
            platformCommentId: tweet.id,
            text: tweet.text,
            raw: tweet,
          };
        });

      return {
        platform: PLATFORMS.X,
        success: true,
        comments,
        raw: res.data,
      };
    },

    async replyToComment({ commentId, replyText }) {
      return replyThread({
        client,
        parentTweetId: commentId,
        replyText,
      });
    },

    async replyToPost({ postId, replyText }) {
      return replyThread({
        client,
        parentTweetId: postId,
        replyText,
      });
    },
  };
}

async function replyThread({ client, parentTweetId, replyText }) {
  ensureWriteCredentials();

  const tweets = splitTweetText(replyText);
  let replyParentId = parentTweetId;
  let firstReply = null;
  let lastReply = null;

  for (const text of tweets) {
    const tweet = await createTweet({
      client,
      text,
      inReplyToTweetId: replyParentId,
    });

    if (!firstReply) {
      firstReply = tweet;
    }

    lastReply = tweet;
    replyParentId = tweet.id;
  }

  return {
    platform: PLATFORMS.X,
    success: true,
    replyId: firstReply.id,
    lastReplyId: lastReply.id,
    parentCommentId: parentTweetId,
    url: xStatusUrl(firstReply.id),
    text: replyText,
    raw: {
      firstReply,
      lastReply,
      tweetCount: tweets.length,
    },
  };
}

async function createTweet({ client, text, inReplyToTweetId }) {
  const path = "/tweets";
  const body = {
    text,
  };

  if (inReplyToTweetId) {
    body.reply = {
      in_reply_to_tweet_id: inReplyToTweetId,
    };
  }

  const url = `${client.defaults.baseURL}${path}`;
  const res = await client.post(path, body, {
    headers: writeHeaders({
      method: "POST",
      url,
    }),
  });

  return res.data.data;
}

function readHeaders() {
  const token = process.env.X_BEARER_TOKEN || process.env.X_USER_ACCESS_TOKEN;

  return {
    Authorization: `Bearer ${token}`,
  };
}

function writeHeaders({ method, url }) {
  if (process.env.X_USER_ACCESS_TOKEN) {
    return {
      Authorization: `Bearer ${process.env.X_USER_ACCESS_TOKEN}`,
    };
  }

  return {
    Authorization: oauth1AuthorizationHeader({
      method,
      url,
      apiKey: process.env.X_API_KEY,
      apiSecret: process.env.X_API_SECRET,
      accessToken: process.env.X_ACCESS_TOKEN,
      accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET,
    }),
  };
}

function oauth1AuthorizationHeader({
  method,
  url,
  apiKey,
  apiSecret,
  accessToken,
  accessTokenSecret,
}) {
  const oauthParams = {
    oauth_consumer_key: apiKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: "1.0",
  };
  const signatureParams = {
    ...oauthParams,
    ...Object.fromEntries(new URL(url).searchParams.entries()),
  };
  const parameterString = Object.keys(signatureParams)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(signatureParams[key])}`)
    .join("&");
  const signatureBaseString = [
    method.toUpperCase(),
    percentEncode(url.split("?")[0]),
    percentEncode(parameterString),
  ].join("&");
  const signingKey = `${percentEncode(apiSecret)}&${percentEncode(accessTokenSecret)}`;
  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(signatureBaseString)
    .digest("base64");

  return (
    "OAuth " +
    Object.entries({
      ...oauthParams,
      oauth_signature: signature,
    })
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`)
      .join(", ")
  );
}

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}

function splitTweetText(text) {
  const normalized = String(text || "").trim();

  if (normalized.length <= TWEET_LIMIT) {
    return [normalized];
  }

  const chunks = [];
  let current = "";

  for (const line of normalized.split("\n")) {
    const candidate = current ? `${current}\n${line}` : line;

    if (candidate.length <= TWEET_LIMIT) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (line.length <= TWEET_LIMIT) {
      current = line;
      continue;
    }

    for (let index = 0; index < line.length; index += TWEET_LIMIT) {
      chunks.push(line.slice(index, index + TWEET_LIMIT));
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function ensureReadCredentials() {
  if (!process.env.X_BEARER_TOKEN && !process.env.X_USER_ACCESS_TOKEN) {
    throw new Error("Missing X_BEARER_TOKEN or X_USER_ACCESS_TOKEN");
  }
}

function ensureWriteCredentials() {
  if (process.env.X_USER_ACCESS_TOKEN) {
    return;
  }

  const required = [
    "X_API_KEY",
    "X_API_SECRET",
    "X_ACCESS_TOKEN",
    "X_ACCESS_TOKEN_SECRET",
  ];
  const missing = required.filter((name) => !process.env[name]);

  if (missing.length) {
    throw new Error(`Missing X write credentials: ${missing.join(", ")}`);
  }
}

function xStatusUrl(tweetId) {
  const username = process.env.X_BOT_USERNAME || "i";

  return `https://x.com/${username}/status/${tweetId}`;
}

module.exports = {
  createXAdapter,
  splitTweetText,
};
