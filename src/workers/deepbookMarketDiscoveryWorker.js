const cron = require("node-cron");
const {
  createDeepbookPredictClient,
  normalizeScaledPrice,
  readExpiryMs,
  readField,
  readNumber,
  readObjectId,
  readOracleStatus,
  readUnderlyingAsset,
} = require("../services/deepbookPredictClient");
const { createSocialBotService } = require("../services/socialBotService");
const { logBotActivity } = require("../services/botActivity");
const { PLATFORMS } = require("../utils/platform");
const { isSystemPaused } = require("../services/systemControl");

function startDeepbookMarketDiscoveryWorker(prisma) {
  if (process.env.DEEPBOOK_PREDICT_AUTODISCOVERY_ENABLED === "false") {
    console.log("DeepBook Predict discovery worker disabled");
    return;
  }

  const intervalMinutes = Number(process.env.DEEPBOOK_DISCOVERY_INTERVAL_MINUTES || 5);
  const cronExpression = `*/${intervalMinutes} * * * *`;
  const client = createDeepbookPredictClient();
  const socialBotService = createSocialBotService(prisma);

  cron.schedule(cronExpression, async () => {
    if (isSystemPaused()) {
      return;
    }

    await discoverAndPostDeepbookMarket({
      prisma,
      client,
      socialBotService,
    });
  });

  console.log("DeepBook Predict discovery worker started");
}

async function discoverAndPostDeepbookMarket({
  prisma,
  client = createDeepbookPredictClient(),
  socialBotService = createSocialBotService(prisma),
}) {
  const now = new Date();

  try {
    const minimumPostIntervalMs =
      Number(process.env.DEEPBOOK_MIN_POST_INTERVAL_MINUTES || 4) * 60 * 1000;

    const latestPosted = await prisma.market.findFirst({
      where: {
        source: "DEEPBOOK_PREDICT",
        xpSocialPostId: {
          not: null,
        },
      },
      orderBy: {
        botPostedAt: "desc",
      },
    });

    if (
      latestPosted?.botPostedAt &&
      now.getTime() - latestPosted.botPostedAt.getTime() < minimumPostIntervalMs
    ) {
      await logBotActivity(
        prisma,
        "DEEPBOOK_DISCOVERY_SKIPPED",
        "DeepBook Predict post interval has not elapsed",
        {
          latestMarketId: latestPosted.id,
          latestMarketNumber: latestPosted.marketNumber,
          latestBotPostedAt: latestPosted.botPostedAt,
          minimumPostIntervalMinutes:
            Number(process.env.DEEPBOOK_MIN_POST_INTERVAL_MINUTES || 4),
        },
      );

      return { posted: false, reason: "POST_INTERVAL_NOT_ELAPSED" };
    }

    const status = await client.getStatus();

    if (!isPredictServerHealthy(status)) {
      await logBotActivity(
        prisma,
        "DEEPBOOK_DISCOVERY_SKIPPED",
        "DeepBook Predict server is not healthy",
        { status },
      );

      return { posted: false, reason: "PREDICT_SERVER_UNHEALTHY" };
    }

    const oracles = await client.getPredictOracles();
    const selectedOracle = selectTradeableBtcOracle(oracles, now);

    if (!selectedOracle) {
      await logBotActivity(
        prisma,
        "DEEPBOOK_DISCOVERY_SKIPPED",
        "No tradeable BTC DeepBook Predict oracle found",
        { oracleCount: oracles.length },
      );

      return { posted: false, reason: "NO_TRADEABLE_BTC_ORACLE" };
    }

    const oracleId = readObjectId(selectedOracle);
    const [oracleState, latestPrice, latestSvi] = await Promise.all([
      client.getOracleState(oracleId),
      client.getLatestOraclePrice(oracleId),
      client.getLatestOracleSvi(oracleId).catch((error) => ({
        error: error.message,
      })),
    ]);

    const spotPrice = extractSpotPrice(latestPrice, oracleState, selectedOracle);
    const strike = chooseStrike({
      spotPrice,
      oracleState,
      selectedOracle,
    });

    if (!spotPrice || !strike) {
      await logBotActivity(
        prisma,
        "DEEPBOOK_DISCOVERY_SKIPPED",
        "DeepBook Predict oracle did not expose enough price data",
        { oracleId, latestPrice, oracleState },
      );

      return { posted: false, reason: "MISSING_PRICE_DATA" };
    }

    const direction = process.env.DEEPBOOK_DEFAULT_DIRECTION || "UP";
    const existing = await prisma.market.findFirst({
      where: {
        predictOracleId: oracleId,
        predictStrike: strike,
        predictDirection: direction,
      },
    });

    if (existing) {
      const shouldRetryPosting =
        existing.status === "OPEN" &&
        ((process.env.X_BOT_ENABLED === "true" && !existing.xPostId) ||
          !existing.xpSocialPostId);

      if (shouldRetryPosting) {
        const postResults = await socialBotService.postMarketToAllPlatforms({
          market: existing,
        });
        const xpSocialPost = postResults.find(
          (result) => result.platform === PLATFORMS.XP_SOCIAL,
        );
        const xPost = postResults.find((result) => result.platform === PLATFORMS.X);

        const postedMarket = await prisma.market.update({
          where: {
            id: existing.id,
          },
          data: {
            botPostedAt: new Date(),
            xpSocialPostId: xpSocialPost?.postId || existing.xpSocialPostId,
            xPostId: xPost?.postId || existing.xPostId,
          },
        });

        await logBotActivity(
          prisma,
          "DEEPBOOK_MARKET_POST_RETRIED",
          `DeepBook Predict market #${existing.marketNumber} post retried`,
          {
            marketId: existing.id,
            marketNumber: existing.marketNumber,
            posts: postResults.map((result) => ({
              platform: result.platform,
              postId: result.postId,
              url: result.url,
            })),
          },
        );

        return { posted: true, reason: "RETRIED_EXISTING_MARKET", market: postedMarket };
      }

      return { posted: false, reason: "DUPLICATE_MARKET", market: existing };
    }

    const expiryTime = new Date(readExpiryMs(selectedOracle) || readExpiryMs(oracleState));
    const marketNumber = await getNextMarketNumber(prisma);
    const question = `BTC above $${formatPrice(strike)} by ${formatUtcTime(expiryTime)} UTC?`;

    const market = await prisma.market.create({
      data: {
        marketNumber,
        question,
        asset: "BTC",
        targetPrice: strike,
        referencePrice: spotPrice,
        expiryTime,
        yesPrice: 0.5,
        noPrice: 0.5,
        marketType: "DEEPBOOK_PREDICT_BTC",
        source: "DEEPBOOK_PREDICT",
        predictOracleId: oracleId,
        predictExpiry: expiryTime,
        predictStrike: strike,
        predictDirection: direction,
        predictMarketType: "ABOVE_STRIKE",
        predictMarketKeyJson: buildMarketKeyJson({
          oracleId,
          expiryTime,
          strike,
          direction,
        }),
        predictServerPayload: {
          status,
          oracle: selectedOracle,
          oracleState,
          latestPrice,
          latestSvi,
        },
        botPostReason: "TARGET_15_MINUTE_ACTIVE_BTC_ORACLE_ATM_STRIKE",
        oracleStatus: readOracleStatus(oracleState || selectedOracle),
        settlementStatus: "OPEN",
      },
    });

    const postResults = await socialBotService.postMarketToAllPlatforms({ market });
    const xpSocialPost = postResults.find(
      (result) => result.platform === PLATFORMS.XP_SOCIAL,
    );
    const xPost = postResults.find((result) => result.platform === PLATFORMS.X);

    const postedMarket = await prisma.market.update({
      where: {
        id: market.id,
      },
      data: {
        botPostedAt: new Date(),
        xpSocialPostId: xpSocialPost?.postId,
        xPostId: xPost?.postId,
      },
    });

    await logBotActivity(
      prisma,
      "DEEPBOOK_MARKET_POSTED",
      `DeepBook Predict market #${market.marketNumber} posted to socials`,
      {
        marketId: market.id,
        marketNumber: market.marketNumber,
        oracleId,
        strike,
        direction,
        spotPrice,
        expiryTime,
        posts: postResults.map((result) => ({
          platform: result.platform,
          postId: result.postId,
          url: result.url,
        })),
      },
    );

    return { posted: true, market: postedMarket };
  } catch (error) {
    console.error("DeepBook Predict discovery worker error:", error.message);

    await logBotActivity(
      prisma,
      "DEEPBOOK_DISCOVERY_ERROR",
      "DeepBook Predict discovery failed",
      { error: error.message },
    );

    return { posted: false, reason: "ERROR", error };
  }
}

function isPredictServerHealthy(status) {
  const health = String(
    readField(status, ["status", "health", "state"]) || "OK",
  ).toUpperCase();

  return !["DOWN", "ERROR", "UNHEALTHY"].includes(health);
}

function selectTradeableBtcOracle(oracles, now = new Date()) {
  const minimumTimeToExpiryMs =
    Number(process.env.DEEPBOOK_MIN_TIME_TO_EXPIRY_MINUTES || 10) * 60 * 1000;
  const targetTimeToExpiryMs =
    Number(process.env.DEEPBOOK_TARGET_TIME_TO_EXPIRY_MINUTES || 15) * 60 * 1000;
  const maximumTimeToExpiryMs = process.env.DEEPBOOK_MAX_TIME_TO_EXPIRY_MINUTES
    ? Number(process.env.DEEPBOOK_MAX_TIME_TO_EXPIRY_MINUTES) * 60 * 1000
    : 15 * 60 * 1000;

  return oracles
    .map((oracle) => {
      const expiryMs = readExpiryMs(oracle);
      const timeToExpiryMs = expiryMs ? expiryMs - now.getTime() : null;

      return {
        oracle,
        oracleId: readObjectId(oracle),
        asset: readUnderlyingAsset(oracle),
        status: readOracleStatus(oracle),
        expiryMs,
        timeToExpiryMs,
      };
    })
    .filter((candidate) => candidate.oracleId)
    .filter((candidate) => candidate.asset.includes("BTC"))
    .filter((candidate) => candidate.status === "ACTIVE" || candidate.status === "UNKNOWN")
    .filter((candidate) => {
      if (!candidate.timeToExpiryMs) return false;
      if (candidate.timeToExpiryMs < minimumTimeToExpiryMs) return false;
      return !maximumTimeToExpiryMs || candidate.timeToExpiryMs <= maximumTimeToExpiryMs;
    })
    .sort((a, b) => {
      const aDistance = Math.abs(a.timeToExpiryMs - targetTimeToExpiryMs);
      const bDistance = Math.abs(b.timeToExpiryMs - targetTimeToExpiryMs);

      if (aDistance !== bDistance) {
        return aDistance - bDistance;
      }

      return a.expiryMs - b.expiryMs;
    })[0]?.oracle;
}

function extractSpotPrice(...sources) {
  for (const source of sources) {
    const directPrice = readNumber(source, [
      "price",
      "spotPrice",
      "spot_price",
      "spot",
      "indexPrice",
      "index_price",
      "forward",
      "mid",
    ]);

    if (directPrice) {
      return normalizeScaledPrice(directPrice);
    }

    const nestedPrice = readNumber(source?.data, [
      "price",
      "spotPrice",
      "spot_price",
      "spot",
      "indexPrice",
      "index_price",
      "forward",
    ]);

    if (nestedPrice) {
      return normalizeScaledPrice(nestedPrice);
    }
  }

  return null;
}

function chooseStrike({ spotPrice, oracleState, selectedOracle }) {
  const gridStrike =
    chooseGridStrike(spotPrice, oracleState) ||
    chooseGridStrike(spotPrice, selectedOracle);

  if (gridStrike) {
    return gridStrike;
  }

  const candidates = extractStrikeCandidates(oracleState).concat(
    extractStrikeCandidates(selectedOracle),
  );

  if (candidates.length) {
    return candidates.sort(
      (a, b) => Math.abs(a - spotPrice) - Math.abs(b - spotPrice),
    )[0];
  }

  return Math.round(spotPrice / 100) * 100;
}

function chooseGridStrike(spotPrice, source) {
  const minStrike = normalizeScaledPrice(
    readNumber(source, ["minStrike", "min_strike"]),
  );
  const tickSize = normalizeScaledPrice(
    readNumber(source, ["tickSize", "tick_size"]),
  );

  if (!minStrike || !tickSize || spotPrice < minStrike) {
    return null;
  }

  const ticksAboveMin = Math.round((spotPrice - minStrike) / tickSize);
  return minStrike + ticksAboveMin * tickSize;
}

function extractStrikeCandidates(source) {
  const rawCandidates =
    readField(source, ["strikes", "strikePrices", "strike_prices"]) ||
    readField(source?.data, ["strikes", "strikePrices", "strike_prices"]) ||
    [];

  if (!Array.isArray(rawCandidates)) {
    return [];
  }

  return rawCandidates
    .map((strike) => normalizeScaledPrice(readField(strike, ["price", "strike"]) || strike))
    .filter((strike) => Number.isFinite(strike) && strike > 0);
}

function buildMarketKeyJson({ oracleId, expiryTime, strike, direction }) {
  return {
    oracleId,
    expiryMs: expiryTime.getTime(),
    strike,
    direction,
    type: "ABOVE_STRIKE",
  };
}

async function getNextMarketNumber(prisma) {
  const latest = await prisma.market.findFirst({
    orderBy: {
      marketNumber: "desc",
    },
  });

  return latest ? latest.marketNumber + 1 : 1;
}

function formatPrice(price) {
  return Number(price).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
}

function formatUtcTime(date) {
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");

  return `${hours}:${minutes}`;
}

module.exports = {
  discoverAndPostDeepbookMarket,
  startDeepbookMarketDiscoveryWorker,
};
