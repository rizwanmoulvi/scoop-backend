const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const axios = require("axios");
const { PrismaClient } = require("@prisma/client");
require("dotenv").config();

const { startMarketExpiryWorker } = require("./workers/marketExpiryWorker");
const { parseOrderCommand } = require("./utils/parseOrderCommand");
const { createDemoWallet } = require("./utils/createDemoWallet");
const { generateMarketPost } = require("./utils/generateMarketPost");
const { generateResultPost } = require("./utils/generateResultPost");
const { resolveMarket } = require("./services/resolveMarket");
const { handleSocialComment } = require("./services/handleSocialComment");
const { generateRedditPost } = require("./utils/generateRedditPost");
const { normalizePlatform } = require("./utils/platform");
const { createSocialBotService } = require("./services/socialBotService");
const { PLATFORMS } = require("./utils/platform");
const { startAutoBtcMarketWorker } = require("./workers/autoBtcMarketWorker");
const {
  startDeepbookMarketDiscoveryWorker,
} = require("./workers/deepbookMarketDiscoveryWorker");
const {
  startDeepbookSettlementWorker,
} = require("./workers/deepbookSettlementWorker");
const { getBitcoinPriceUsd } = require("./services/btcPriceService");
const {
  getDusdcBalance,
  getSuiBalance,
} = require("./crypto/sui/suiBalanceService");
const { createSuiWallet } = require("./crypto/sui/suiWalletService");
const { ensureUserSuiWallet } = require("./crypto/sui/ensureUserSuiWallet");
const { sendSuiForGas } = require("./crypto/sui/suiGasService");
const { payWinningOrders } = require("./services/payWinningOrders");

const {
  startXpSocialCommentWorker,
} = require("./workers/xpSocialCommentWorker");
const { startXCommentWorker } = require("./workers/xCommentWorker");
const {
  postMarketResultToSocials,
} = require("./services/postMarketResultToSocials");

const {
  startMarketResolutionWorker,
} = require("./workers/marketResolutionWorker");
const { logBotActivity } = require("./services/botActivity");
const {
  getSystemStatus,
  pauseSystem,
  requireSystemControl,
  restoreSystemControlFromDatabase,
  resumeSystem,
} = require("./services/systemControl");

const app = express();
const prisma = new PrismaClient();
const socialBotService = createSocialBotService(prisma);

const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(
  /\/+$/,
  "",
);
const oauthStates = new Map();
const sessions = new Map();
const SESSION_COOKIE = "xpredict_session";

app.use(
  cors({
    origin: frontendUrl,
    credentials: true,
  }),
);
app.use(express.json());

function getXOAuthConfig() {
  return {
    clientId: process.env.X_OAUTH_CLIENT_ID || process.env.X_CLIENT_ID,
    clientSecret: process.env.X_OAUTH_CLIENT_SECRET || process.env.X_CLIENT_SECRET,
    callbackUrl:
      process.env.X_OAUTH_CALLBACK_URL ||
      `http://localhost:${process.env.PORT || 5050}/auth/x/callback`,
    scopes: process.env.X_OAUTH_SCOPES || "tweet.read users.read",
  };
}

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function parseCookies(req) {
  const header = req.headers.cookie || "";

  return header.split(";").reduce((cookies, pair) => {
    const index = pair.indexOf("=");

    if (index === -1) {
      return cookies;
    }

    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();

    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function setSessionCookie(res, sessionId) {
  const useCrossSiteCookie =
    process.env.NODE_ENV === "production" || frontendUrl.startsWith("https://");

  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: useCrossSiteCookie ? "none" : "lax",
    secure: useCrossSiteCookie,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function clearSessionCookie(res) {
  const useCrossSiteCookie =
    process.env.NODE_ENV === "production" || frontendUrl.startsWith("https://");

  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: useCrossSiteCookie ? "none" : "lax",
    secure: useCrossSiteCookie,
    path: "/",
  });
}

async function getSessionUser(req) {
  const sessionId = parseCookies(req)[SESSION_COOKIE];

  if (!sessionId) {
    return null;
  }

  const session = sessions.get(sessionId);

  if (!session) {
    return null;
  }

  return prisma.user.findUnique({
    where: {
      id: session.userId,
    },
    include: {
      orders: {
        include: {
          market: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });
}

async function requireSessionUser(req, res) {
  const user = await getSessionUser(req);

  if (!user) {
    res.status(401).json({
      success: false,
      error: "Sign in with X first",
    });
    return null;
  }

  return user;
}

async function getBalancesForUser(user) {
  if (!user?.suiAddress) {
    return {
      sui: null,
      dusdc: null,
    };
  }

  try {
    const [sui, dusdc] = await Promise.all([
      getSuiBalance(user.suiAddress),
      getDusdcBalance(user.suiAddress),
    ]);

    return {
      sui,
      dusdc,
    };
  } catch (error) {
    return {
      sui: null,
      dusdc: null,
      error: error.message,
    };
  }
}

async function findOrCreateXUser(xUser) {
  let user = await prisma.user.findUnique({
    where: {
      platform_platformUserId: {
        platform: PLATFORMS.X,
        platformUserId: xUser.id,
      },
    },
  });

  if (!user) {
    const suiWallet = await createSuiWallet();

    user = await prisma.user.create({
      data: {
        platform: PLATFORMS.X,
        platformUserId: xUser.id,
        username: xUser.username,
        walletAddress: suiWallet.address,
        suiAddress: suiWallet.address,
        suiPrivateKey: suiWallet.privateKey,
        suiPublicKey: suiWallet.publicKey,
        cryptoWalletCreated: true,
        demoBalance: 0,
      },
    });

    user = await ensureUserSuiWallet({
      prisma,
      user,
      mention: `@${xUser.username}`,
    });

    try {
      await sendSuiForGas({
        recipientAddress: user.suiAddress,
        amountSui: 0.05,
      });
    } catch (error) {
      await logBotActivity(
        prisma,
        "SUI_GAS_FUNDING_FAILED",
        `Failed to fund SUI gas for @${xUser.username} OAuth wallet`,
        {
          userId: user.id,
          username: user.username,
          error: error.message,
        },
      );
    }
  } else if (user.username !== xUser.username) {
    try {
      user = await prisma.user.update({
        where: {
          id: user.id,
        },
        data: {
          username: xUser.username,
        },
      });
    } catch (error) {
      console.warn("Unable to update X username from OAuth profile:", error.message);
    }
  }

  return user;
}

function serializePublicUser(user) {
  return {
    id: user.id,
    platform: user.platform,
    platformUserId: user.platformUserId,
    username: user.username,
    walletAddress: user.walletAddress,
    suiAddress: user.suiAddress,
    predictManagerId: user.predictManagerId,
    createdAt: user.createdAt,
    orders: user.orders || [],
  };
}

app.get("/", (req, res) => {
  res.json({
    message: "XPredict API running",
  });
});

app.get("/system/status", (req, res) => {
  res.json({
    success: true,
    system: getSystemStatus(),
  });
});

app.post("/system/pause", async (req, res) => {
  if (!requireSystemControl(req, res)) {
    return;
  }

  const system = pauseSystem({
    by: req.headers["x-system-control-by"] || "api",
    pauseReason: req.body?.reason || "",
  });

  try {
    await logBotActivity(
      prisma,
      "SYSTEM_PAUSED",
      "Scoop automation paused",
      {
        ...system,
        updatedAt: system.updatedAt.toISOString(),
      },
    );
  } catch (error) {
    console.warn("Failed to log system pause:", error.message);
  }

  res.json({
    success: true,
    system,
  });
});

app.post("/system/resume", async (req, res) => {
  if (!requireSystemControl(req, res)) {
    return;
  }

  const system = resumeSystem({
    by: req.headers["x-system-control-by"] || "api",
  });

  try {
    await logBotActivity(
      prisma,
      "SYSTEM_RESUMED",
      "Scoop automation resumed",
      {
        ...system,
        updatedAt: system.updatedAt.toISOString(),
      },
    );
  } catch (error) {
    console.warn("Failed to log system resume:", error.message);
  }

  res.json({
    success: true,
    system,
  });
});

app.get("/auth/x/login", (req, res) => {
  const { clientId, callbackUrl, scopes } = getXOAuthConfig();

  if (!clientId) {
    return res.status(500).json({
      success: false,
      error: "X OAuth Client ID is not configured",
    });
  }

  const state = base64Url(crypto.randomBytes(24));
  const codeVerifier = base64Url(crypto.randomBytes(48));
  const codeChallenge = base64Url(
    crypto.createHash("sha256").update(codeVerifier).digest(),
  );

  oauthStates.set(state, {
    codeVerifier,
    createdAt: Date.now(),
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: scopes,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const query = params.toString().replace(/\+/g, "%20");

  res.redirect(`https://x.com/i/oauth2/authorize?${query}`);
});

app.get("/auth/x/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(`${frontendUrl}/?auth_error=${encodeURIComponent(error)}`);
    }

    const oauthState = oauthStates.get(state);

    if (!code || !state || !oauthState) {
      return res.redirect(`${frontendUrl}/?auth_error=invalid_oauth_state`);
    }

    oauthStates.delete(state);

    if (Date.now() - oauthState.createdAt > 10 * 60 * 1000) {
      return res.redirect(`${frontendUrl}/?auth_error=expired_oauth_state`);
    }

    const { clientId, clientSecret, callbackUrl } = getXOAuthConfig();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl,
      code_verifier: oauthState.codeVerifier,
    });

    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
    };

    if (clientSecret) {
      headers.Authorization = `Basic ${Buffer.from(
        `${clientId}:${clientSecret}`,
      ).toString("base64")}`;
    } else {
      body.set("client_id", clientId);
    }

    const tokenResponse = await axios.post(
      "https://api.x.com/2/oauth2/token",
      body.toString(),
      {
        headers,
      },
    );

    const accessToken = tokenResponse.data.access_token;

    const profileResponse = await axios.get("https://api.x.com/2/users/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      params: {
        "user.fields": "profile_image_url,username,name",
      },
    });

    const user = await findOrCreateXUser(profileResponse.data.data);
    const sessionId = base64Url(crypto.randomBytes(32));

    sessions.set(sessionId, {
      userId: user.id,
      createdAt: Date.now(),
    });
    setSessionCookie(res, sessionId);

    res.redirect(frontendUrl);
  } catch (error) {
    console.error("X OAuth callback failed:", error.response?.data || error.message);
    res.redirect(`${frontendUrl}/?auth_error=x_oauth_failed`);
  }
});

app.get("/auth/me", async (req, res) => {
  try {
    const hasSessionCookie = Boolean(parseCookies(req)[SESSION_COOKIE]);
    const user = await getSessionUser(req);

    if (!user) {
      return res.json({
        success: true,
        user: null,
        session: {
          hasSessionCookie,
        },
      });
    }

    const balances = await getBalancesForUser(user);

    res.json({
      success: true,
      user: serializePublicUser(user),
      balances,
      session: {
        hasSessionCookie,
      },
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/auth/logout", (req, res) => {
  const sessionId = parseCookies(req)[SESSION_COOKIE];

  if (sessionId) {
    sessions.delete(sessionId);
  }

  clearSessionCookie(res);

  res.json({
    success: true,
  });
});

app.post("/markets", async (req, res) => {
  try {
    const {
      marketNumber,
      question,
      asset,
      targetPrice,
      expiryTime,
      yesPrice,
      noPrice,
      xPostId,
      redditPostId,
      redditSubreddit,
      xpSocialPostId,
    } = req.body;

    const market = await prisma.market.create({
      data: {
        marketNumber,
        question,
        asset,
        targetPrice,
        expiryTime: new Date(expiryTime),
        yesPrice,
        noPrice,
        xPostId,
        redditPostId,
        redditSubreddit,
        xpSocialPostId,
      },
    });

    await logBotActivity(
      prisma,
      "MARKET_CREATED",
      `Market #${market.marketNumber} created`,
      {
        marketId: market.id,
        marketNumber: market.marketNumber,
        question: market.question,
        xPostId: market.xPostId,
        redditPostId: market.redditPostId,
        redditSubreddit: market.redditSubreddit,
        xpSocialPostId: market.xpSocialPostId,
      },
    );

    res.json({
      success: true,
      market,
      postText: generateMarketPost(market),
      redditPost: generateRedditPost(market),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/markets", async (req, res) => {
  try {
    const markets = await prisma.market.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json({
      success: true,
      markets,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/simulate-comment", async (req, res) => {
  try {
    const {
      platform = "X",
      platformUserId,
      username,
      platformPostId,
      platformCommentId,
      text,

      // backwards compatibility with old X payload
      xUserId,
      xPostId,
      commentId,
    } = req.body;

    const result = await handleSocialComment({
      prisma,
      platform,
      platformUserId: platformUserId || xUserId,
      username,
      platformPostId: platformPostId || xPostId,
      platformCommentId: platformCommentId || commentId,
      text,
    });

    let socialReply = null;

    if (result.reply) {
      try {
        const normalizedPlatform = normalizePlatform(platform);

        socialReply = await socialBotService.replyToPlatformComment({
          platform: normalizedPlatform,
          commentId: platformCommentId || commentId,
          replyText: result.reply,
        });
      } catch (replyError) {
        await logBotActivity(
          prisma,
          "SOCIAL_REPLY_FAILED",
          `Failed to mock-post social reply`,
          {
            platform,
            commentId: platformCommentId || commentId,
            error: replyError.message,
          },
        );
      }
    }

    res.status(result.success ? 200 : 400).json({
      ...result,
      socialReply,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/users/:platform/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const { platform } = req.params;
    const normalizedPlatform = normalizePlatform(platform);

    const user = await prisma.user.findUnique({
      where: {
        platform_username: {
          platform: normalizedPlatform,
          username,
        },
      },
      include: {
        orders: {
          include: {
            market: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    res.json({
      success: true,
      user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/prices/btc", async (req, res) => {
  try {
    const priceData = await getBitcoinPriceUsd();

    res.json({
      success: true,
      ...priceData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/markets/:id/resolve", async (req, res) => {
  try {
    const { id } = req.params;
    const { result, resolvedPrice } = req.body;

    const resolved = await resolveMarket({
      prisma,
      marketId: id,
      result,
      resolvedPrice,
    });

    const payoutResult = await payWinningOrders({
      prisma,
      marketId: id,
    });

    const updatedResolvedMarket = await prisma.market.findUnique({
      where: {
        id,
      },
    });

    const socialResult = await postMarketResultToSocials({
      prisma,
      market: updatedResolvedMarket,
    });

    res.json({
      success: true,
      ...resolved,
      payoutResult,
      socialResult,
    });
  } catch (error) {
    console.error(error);

    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/markets/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const market = await prisma.market.findUnique({
      where: { id },
      include: {
        orders: {
          include: {
            user: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    if (!market) {
      return res.status(404).json({
        success: false,
        error: "Market not found",
      });
    }

    const yesOrders = market.orders.filter((order) => order.side === "YES");
    const noOrders = market.orders.filter((order) => order.side === "NO");

    const yesVolume = yesOrders.reduce(
      (sum, order) => sum + Number(order.amount),
      0,
    );

    const noVolume = noOrders.reduce(
      (sum, order) => sum + Number(order.amount),
      0,
    );

    const stats = {
      totalOrders: market.orders.length,
      yesOrders: yesOrders.length,
      noOrders: noOrders.length,
      yesVolume,
      noVolume,
      totalVolume: yesVolume + noVolume,
    };

    res.json({
      success: true,
      market,
      stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/markets/:id/orders", async (req, res) => {
  try {
    const user = await requireSessionUser(req, res);

    if (!user) {
      return;
    }

    const { id } = req.params;
    const { side, amount } = req.body;
    const market = await prisma.market.findUnique({
      where: {
        id,
      },
    });

    if (!market) {
      return res.status(404).json({
        success: false,
        error: "Market not found",
      });
    }

    if (!market.xPostId) {
      return res.status(400).json({
        success: false,
        error: "This market is not available for X-authenticated orders",
      });
    }

    const normalizedSide = String(side || "").trim().toUpperCase();
    const numericAmount = Number(amount);

    if (!["YES", "NO"].includes(normalizedSide) || !Number.isFinite(numericAmount)) {
      return res.status(400).json({
        success: false,
        error: "Enter YES or NO and a valid USDC amount",
      });
    }

    const platformCommentId = `web_${user.id}_${market.id}_${Date.now()}`;
    const result = await handleSocialComment({
      prisma,
      platform: PLATFORMS.X,
      platformUserId: user.platformUserId,
      username: user.username,
      platformPostId: market.xPostId,
      platformCommentId,
      text: `${normalizedSide} ${numericAmount} USDC`,
    });

    const order = await prisma.order.findUnique({
      where: {
        sourcePlatform_sourceCommentId: {
          sourcePlatform: PLATFORMS.X,
          sourceCommentId: platformCommentId,
        },
      },
      include: {
        market: true,
        user: true,
      },
    });

    res.status(result.success ? 200 : 400).json({
      ...result,
      order,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/orders", async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      include: {
        user: true,
        market: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json({
      success: true,
      orders,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/orders/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        user: true,
        market: true,
      },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
      });
    }

    res.json({
      success: true,
      order,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/users/:platform/:username/faucet", async (req, res) => {
  try {
    const { username } = req.params;
    const { amount = 100 } = req.body;
    const { platform } = req.params;
    const normalizedPlatform = normalizePlatform(platform);

    if (amount <= 0 || amount > 1000) {
      return res.status(400).json({
        success: false,
        error: "Faucet amount must be between 1 and 1000 dUSDC",
      });
    }

    const user = await prisma.user.update({
      where: {
        platform_username: {
          platform: normalizedPlatform,
          username,
        },
      },
      data: {
        demoBalance: {
          increment: amount,
        },
      },
    });

    res.json({
      success: true,
      message: `${amount} dUSDC added to @${username}`,
      user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/markets/:id/expire", async (req, res) => {
  try {
    const { id } = req.params;

    const market = await prisma.market.findUnique({
      where: { id },
    });

    if (!market) {
      return res.status(404).json({
        success: false,
        error: "Market not found",
      });
    }

    if (market.status !== "OPEN") {
      return res.status(400).json({
        success: false,
        error: `Market is already ${market.status}`,
      });
    }

    const updatedMarket = await prisma.market.update({
      where: { id },
      data: {
        status: "EXPIRED",
      },
    });

    res.json({
      success: true,
      message: `Market #${market.marketNumber} expired`,
      market: updatedMarket,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/bot-activity", async (req, res) => {
  try {
    const activities = await prisma.botActivity.findMany({
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    });

    res.json({
      success: true,
      activities,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/markets/:id/social-post", async (req, res) => {
  try {
    const { id } = req.params;

    const market = await prisma.market.findUnique({
      where: {
        id,
      },
    });

    if (!market) {
      return res.status(404).json({
        success: false,
        error: "Market not found",
      });
    }

    const results = await socialBotService.postMarketToAllPlatforms({
      market,
    });

    res.json({
      success: true,
      results,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/markets/:id/social-post/:platform", async (req, res) => {
  try {
    const { id, platform } = req.params;

    const normalizedPlatform = normalizePlatform(platform);

    const market = await prisma.market.findUnique({
      where: {
        id,
      },
    });

    if (!market) {
      return res.status(404).json({
        success: false,
        error: "Market not found",
      });
    }

    const result = await socialBotService.postMarketToPlatform({
      market,
      platform: normalizedPlatform,
    });

    res.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/social/reply", async (req, res) => {
  try {
    const { platform, commentId, replyText } = req.body;

    const normalizedPlatform = normalizePlatform(platform);

    const result = await socialBotService.replyToPlatformComment({
      platform: normalizedPlatform,
      commentId,
      replyText,
    });

    res.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/users/:platform/:username/crypto-balances", async (req, res) => {
  try {
    const { platform, username } = req.params;
    const normalizedPlatform = normalizePlatform(platform);

    const user = await prisma.user.findUnique({
      where: {
        platform_username: {
          platform: normalizedPlatform,
          username,
        },
      },
    });

    if (!user || !user.suiAddress) {
      return res.status(404).json({
        success: false,
        error: "User or Sui wallet not found",
      });
    }

    const [sui, dusdc] = await Promise.all([
      getSuiBalance(user.suiAddress),
      getDusdcBalance(user.suiAddress),
    ]);

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        platform: user.platform,
        suiAddress: user.suiAddress,
      },
      balances: {
        sui,
        dusdc,
      },
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

const PORT = process.env.PORT || 5050;
const ORDER_EXECUTION_MODE =
  process.env.ORDER_EXECUTION_MODE || "DEEPBOOK_PREDICT";

async function startServer() {
  try {
    const system = await restoreSystemControlFromDatabase(prisma);
    console.log(
      system.paused
        ? `Scoop automation restored as paused: ${system.reason || "no reason"}`
        : "Scoop automation restored as running",
    );
  } catch (error) {
    console.warn(
      "Could not restore system control state from database:",
      error.message,
    );
  }

  startXpSocialCommentWorker(prisma);
  startXCommentWorker(prisma);

  if (ORDER_EXECUTION_MODE === "DEEPBOOK_PREDICT") {
    startDeepbookMarketDiscoveryWorker(prisma);
    startDeepbookSettlementWorker(prisma);
  } else {
    startMarketExpiryWorker(prisma);
    startMarketResolutionWorker(prisma);
    startAutoBtcMarketWorker(prisma);
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
