const cron = require("node-cron");
const { getBitcoinPriceUsd } = require("../services/btcPriceService");
const { generateMarketPost } = require("../utils/generateMarketPost");
const { createSocialBotService } = require("../services/socialBotService");
const { logBotActivity } = require("../services/botActivity");
const { PLATFORMS } = require("../utils/platform");
const { isSystemPaused } = require("../services/systemControl");

function startAutoBtcMarketWorker(prisma) {
  if (process.env.LEGACY_AUTO_BTC_MARKETS_ENABLED !== "true") {
    console.log("Legacy auto BTC market worker disabled");
    return;
  }

  const socialBotService = createSocialBotService(prisma);

  // Runs every minute. Creates markets only at minute 00/15/30/45.
  cron.schedule("* * * * *", async () => {
    if (isSystemPaused()) {
      return;
    }

    try {
      const now = new Date();
      const minute = now.getUTCMinutes();

      const shouldCreate = minute % 5 === 0;

      if (!shouldCreate) {
        return;
      }

      const slotKey = getSlotKey(now);

      const existing = await prisma.botActivity.findFirst({
        where: {
          type: "AUTO_BTC_MARKET_CREATED",
          metadata: {
            path: ["slotKey"],
            equals: slotKey,
          },
        },
      });

      if (existing) {
        return;
      }

      const priceData = await getBitcoinPriceUsd();

      const currentPrice = priceData.price;
      const targetPrice = roundToNearestDollar(currentPrice);

      const expiryTime = new Date(now.getTime() + 5 * 60 * 1000);

      const marketNumber = await getNextMarketNumber(prisma);

      const expiryText = formatUtcTime(expiryTime);

      const question = `Will Bitcoin go above $${formatPrice(
        targetPrice
      )} after 1 Hour at ${expiryText} UTC?`;

      const market = await prisma.market.create({
        data: {
          marketNumber,
          question,
          asset: "BTC",
          targetPrice,
          referencePrice: currentPrice,
          expiryTime,
          yesPrice: 0.5,
          noPrice: 0.5,
          marketType: "AUTO_BTC_1H",
        },
      });

      await logBotActivity(
        prisma,
        "AUTO_BTC_MARKET_CREATED",
        `Auto BTC market #${market.marketNumber} created`,
        {
          slotKey,
          marketId: market.id,
          marketNumber: market.marketNumber,
          referencePrice: currentPrice,
          targetPrice,
          expiryTime,
          priceSource: priceData.source,
        }
      );

      const postResult = await socialBotService.postMarketToPlatform({
        market,
        platform: PLATFORMS.XP_SOCIAL,
      });

      await logBotActivity(
        prisma,
        "AUTO_BTC_MARKET_POSTED",
        `Auto BTC market #${market.marketNumber} posted to XP Social`,
        {
          marketId: market.id,
          marketNumber: market.marketNumber,
          xpSocialPostId: postResult.postId,
          url: postResult.url,
        }
      );

      console.log(
        `Auto BTC market #${market.marketNumber} created and posted. Target: ${targetPrice}`
      );
    } catch (error) {
      console.error("Auto BTC market worker error:", error.message);

      await logBotActivity(
        prisma,
        "AUTO_BTC_MARKET_WORKER_ERROR",
        "Auto BTC market worker failed",
        {
          error: error.message,
        }
      );
    }
  });

  console.log("Auto BTC market worker started");
}

async function getNextMarketNumber(prisma) {
  const latest = await prisma.market.findFirst({
    orderBy: {
      marketNumber: "desc",
    },
  });

  return latest ? latest.marketNumber + 1 : 1;
}

function getSlotKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function roundToNearestDollar(price) {
  return Math.round(Number(price));
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
  startAutoBtcMarketWorker,
};
