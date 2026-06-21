const cron = require("node-cron");
const { getBitcoinPriceUsd } = require("../services/btcPriceService");
const { resolveMarket } = require("../services/resolveMarket");
const { logBotActivity } = require("../services/botActivity");
const { payWinningOrders } = require("../services/payWinningOrders");
const {
  postMarketResultToSocials,
} = require("../services/postMarketResultToSocials");
const { isSystemPaused } = require("../services/systemControl");

function startMarketResolutionWorker(prisma) {
  if (process.env.LEGACY_MARKET_WORKERS_ENABLED !== "true") {
    console.log("Legacy market resolution worker disabled");
    return;
  }

  // Runs every 15 seconds for local testing
  cron.schedule("*/15 * * * * *", async () => {
    if (isSystemPaused()) {
      return;
    }

    try {
      const expiredMarkets = await prisma.market.findMany({
        where: {
          status: "EXPIRED",
          source: {
            not: "DEEPBOOK_PREDICT",
          },
        },
      });

      if (expiredMarkets.length === 0) {
        return;
      }

      for (const market of expiredMarkets) {
        let resolvedPrice;

        if (market.asset.toUpperCase() === "BTC") {
          const priceData = await getBitcoinPriceUsd();
          resolvedPrice = priceData.price;
        } else {
          throw new Error(
            `Unsupported asset for real resolution: ${market.asset}`,
          );
        }

        const result =
          Number(resolvedPrice) > Number(market.targetPrice) ? "YES" : "NO";

        const resolved = await resolveMarket({
          prisma,
          marketId: market.id,
          result,
          resolvedPrice,
        });

        const payoutResult = await payWinningOrders({
          prisma,
          marketId: market.id,
        });

        const updatedResolvedMarket = await prisma.market.findUnique({
          where: {
            id: market.id,
          },
        });

        await postMarketResultToSocials({
          prisma,
          market: updatedResolvedMarket,
        });

        await logBotActivity(
          prisma,
          "MARKET_RESOLVED",
          `Market #${market.marketNumber} auto-resolved as ${result}`,
          {
            marketId: market.id,
            marketNumber: market.marketNumber,
            asset: market.asset,
            targetPrice: Number(market.targetPrice),
            resolvedPrice,
            result,
            resultPost: resolved.resultPost,
            payoutResult,
          },
        );

        console.log(
          `Market #${market.marketNumber} auto-resolved as ${result}. Price: ${resolvedPrice}`,
        );

        console.log(resolved.resultPost);
      }
    } catch (error) {
      console.error("Market resolution worker error:", error.message);
    }
  });

  console.log("Market resolution worker started");
}

module.exports = {
  startMarketResolutionWorker,
};
