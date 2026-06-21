const cron = require("node-cron");
const { logBotActivity } = require("../services/botActivity");

function startMarketExpiryWorker(prisma) {
  if (process.env.LEGACY_MARKET_WORKERS_ENABLED !== "true") {
    console.log("Legacy market expiry worker disabled");
    return;
  }

  cron.schedule("*/10 * * * * *", async () => {
    try {
      const now = new Date();

      const expiredMarkets = await prisma.market.findMany({
        where: {
          status: "OPEN",
          expiryTime: {
            lte: now,
          },
        },
      });

      for (const market of expiredMarkets) {
        await prisma.market.update({
          where: {
            id: market.id,
          },
          data: {
            status: "EXPIRED",
          },
        });

        await logBotActivity(
          prisma,
          "MARKET_EXPIRED",
          `Market #${market.marketNumber} expired automatically`,
          {
            marketId: market.id,
            marketNumber: market.marketNumber,
            expiryTime: market.expiryTime,
          }
        );

        console.log(`Market #${market.marketNumber} expired automatically`);
      }
    } catch (error) {
      console.error("Market expiry worker error:", error);
    }
  });

  console.log("Market expiry worker started");
}

module.exports = {
  startMarketExpiryWorker,
};
