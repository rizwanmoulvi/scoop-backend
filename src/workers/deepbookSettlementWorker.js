const cron = require("node-cron");
const {
  createDeepbookPredictClient,
  normalizeScaledPrice,
  readField,
  readNumber,
  readOracleStatus,
} = require("../services/deepbookPredictClient");
const {
  executeDeepbookPredictRedeem,
  executeDeepbookPredictWithdraw,
} = require("../services/deepbookPredictExecutionService");
const { createSuiClient } = require("../crypto/sui/suiClient");
const { getDeepbookPredictConfig } = require("../config/deepbookPredict");
const { logBotActivity } = require("../services/botActivity");
const {
  postMarketResultToSocials,
} = require("../services/postMarketResultToSocials");
const { isSystemPaused } = require("../services/systemControl");

function startDeepbookSettlementWorker(prisma) {
  if (process.env.DEEPBOOK_PREDICT_SETTLEMENT_ENABLED === "false") {
    console.log("DeepBook Predict settlement worker disabled");
    return;
  }

  const intervalSeconds = Number(
    process.env.DEEPBOOK_SETTLEMENT_INTERVAL_SECONDS || 30,
  );
  const cronExpression = `*/${intervalSeconds} * * * * *`;
  const client = createDeepbookPredictClient();
  const suiClient = createSuiClient();

  cron.schedule(cronExpression, async () => {
    if (isSystemPaused()) {
      return;
    }

    await settleResolvedDeepbookMarkets({
      prisma,
      client,
      suiClient,
    });
  });

  console.log("DeepBook Predict settlement worker started");
}

async function settleResolvedDeepbookMarkets({
  prisma,
  client = createDeepbookPredictClient(),
  suiClient = createSuiClient(),
}) {
  const markets = await prisma.market.findMany({
    where: {
      source: "DEEPBOOK_PREDICT",
      status: {
        in: ["OPEN", "EXPIRED"],
      },
      settlementStatus: {
        not: "REDEEMED",
      },
    },
    include: {
      orders: {
        include: {
          user: true,
        },
      },
    },
    orderBy: {
      expiryTime: "asc",
    },
  });

  const settled = [];
  const skipped = [];
  const failed = [];

  for (const market of markets) {
    try {
      const result = await settleDeepbookMarket({
        prisma,
        client,
        suiClient,
        market,
      });

      if (result.settled) {
        settled.push(result);
      } else {
        skipped.push(result);
      }
    } catch (error) {
      failed.push({
        marketId: market.id,
        marketNumber: market.marketNumber,
        error: error.message,
      });

      await logBotActivity(
        prisma,
        "DEEPBOOK_SETTLEMENT_ERROR",
        `DeepBook settlement failed for Market #${market.marketNumber}`,
        {
          marketId: market.id,
          marketNumber: market.marketNumber,
          error: error.message,
        },
      );
    }
  }

  return {
    settled,
    skipped,
    failed,
  };
}

async function settleDeepbookMarket({
  prisma,
  client = createDeepbookPredictClient(),
  suiClient = createSuiClient(),
  market,
}) {
  const oracleState = await client.getOracleState(market.predictOracleId);
  const oracle = oracleState?.oracle || oracleState;
  const oracleStatus = readOracleStatus(oracle);
  const settlementPrice = extractSettlementPrice(oracleState, oracle);

  await prisma.market.update({
    where: {
      id: market.id,
    },
    data: {
      oracleStatus,
      predictServerPayload: {
        ...(market.predictServerPayload || {}),
        latestSettlementCheck: {
          checkedAt: new Date().toISOString(),
          oracleState,
        },
      },
    },
  });

  if (oracleStatus !== "SETTLED" || !settlementPrice) {
    return {
      settled: false,
      reason: "ORACLE_NOT_SETTLED",
      marketId: market.id,
      marketNumber: market.marketNumber,
      oracleStatus,
    };
  }

  const result =
    settlementPrice > Number(market.predictStrike || market.targetPrice)
      ? "YES"
      : "NO";
  const winners = [];
  const losers = [];
  const payoutResults = [];

  for (const order of market.orders) {
    if (order.predictExecutionStatus !== "MINTED") {
      continue;
    }

    if (order.side !== result) {
      await prisma.order.update({
        where: {
          id: order.id,
        },
        data: {
          status: "LOST",
          predictRedeemStatus:
            order.predictRedeemStatus === "REDEEMED"
              ? "REDEEMED"
              : "NOT_ELIGIBLE",
        },
      });

      losers.push({
        username: order.user.username,
        lost: Number(order.amount),
      });

      continue;
    }

    const payout = await settleWinningDeepbookOrder({
      prisma,
      suiClient,
      order,
      market,
    });

    winners.push({
      username: order.user.username,
      payout: Number(order.predictQuantity || 0) / 1_000_000,
      profit:
        Number(order.predictQuantity || 0) / 1_000_000 - Number(order.amount),
    });
    payoutResults.push(payout);
  }

  const resultPost = generateDeepbookResultPost({
    market,
    result,
    settlementPrice,
    winners,
    losers,
    payoutResults,
  });

  const updatedMarket = await prisma.market.update({
    where: {
      id: market.id,
    },
    data: {
      status: "RESOLVED",
      result,
      resolvedPrice: settlementPrice,
      resolvedAt: new Date(),
      resultPost,
      oracleStatus,
      settlementStatus: "REDEEMED",
    },
  });

  const socialResult = await postMarketResultToSocials({
    prisma,
    market: updatedMarket,
  });

  await logBotActivity(
    prisma,
    "DEEPBOOK_MARKET_SETTLED",
    `DeepBook Predict Market #${market.marketNumber} settled as ${result}`,
    {
      marketId: market.id,
      marketNumber: market.marketNumber,
      oracleId: market.predictOracleId,
      result,
      settlementPrice,
      winners: winners.length,
      losers: losers.length,
      payoutResults,
      socialResult,
    },
  );

  return {
    settled: true,
    market: updatedMarket,
    result,
    settlementPrice,
    winners,
    losers,
    payoutResults,
    socialResult,
  };
}

async function settleWinningDeepbookOrder({
  prisma,
  suiClient,
  order,
  market,
}) {
  let redeemDigest = order.predictRedeemDigest;

  if (order.predictRedeemStatus !== "REDEEMED") {
    try {
      const redeem = await executeDeepbookPredictRedeem({
        prisma,
        order: {
          ...order,
          market,
        },
        user: order.user,
        market,
      });

      redeemDigest = redeem.digest;
    } catch (error) {
      const redeemedEvent = await findRedeemEventForOrder({
        suiClient,
        order,
        market,
      });

      if (!redeemedEvent) {
        await prisma.order.update({
          where: {
            id: order.id,
          },
          data: {
            predictRedeemStatus: "FAILED",
          },
        });

        throw error;
      }

      redeemDigest = redeemedEvent.id.txDigest;

      await prisma.order.update({
        where: {
          id: order.id,
        },
        data: {
          predictRedeemDigest: redeemDigest,
          predictRedeemStatus: "REDEEMED",
        },
      });
    }
  }

  let withdrawDigest = order.payoutTxDigest;
  const payoutAmountRaw = order.predictQuantity;

  if (order.payoutStatus !== "PAID") {
    const withdraw = await executeDeepbookPredictWithdraw({
      user: {
        ...order.user,
        predictManagerId: order.predictManagerId,
      },
      amountRaw: payoutAmountRaw,
      managerId: order.predictManagerId,
    });

    withdrawDigest = withdraw.digest;
  }

  const updatedOrder = await prisma.order.update({
    where: {
      id: order.id,
    },
    data: {
      status: "WON",
      predictRedeemDigest: redeemDigest,
      predictRedeemStatus: "REDEEMED",
      payoutStatus: "PAID",
      payoutTxDigest: withdrawDigest,
      payoutAmountRaw,
      paidAt: new Date(),
    },
  });

  await logBotActivity(
    prisma,
    "DEEPBOOK_PAYOUT_WITHDRAWN",
    `Withdrew DeepBook payout for @${order.user.username}`,
    {
      orderId: order.id,
      username: order.user.username,
      marketId: market.id,
      marketNumber: market.marketNumber,
      predictManagerId: order.predictManagerId,
      redeemDigest,
      withdrawDigest,
      payoutAmountRaw,
    },
  );

  return {
    orderId: order.id,
    username: order.user.username,
    redeemDigest,
    withdrawDigest,
    payoutAmountRaw,
    order: updatedOrder,
  };
}

async function findRedeemEventForOrder({
  suiClient = createSuiClient(),
  order,
  market,
}) {
  const config = getDeepbookPredictConfig();
  const type = `${config.packageId}::predict::PositionRedeemed`;
  const expected = {
    managerId: order.predictManagerId,
    oracleId: market.predictOracleId,
    expiry: String(new Date(market.predictExpiry).getTime()),
    strike: String(toPredictPriceUnits(market.predictStrike)),
    isUp: order.side === "YES",
    quantity: String(order.predictQuantity),
  };

  let cursor = null;

  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    const page = await suiClient.queryEvents({
      query: {
        MoveEventType: type,
      },
      cursor,
      limit: 50,
      order: "descending",
    });

    const match = page.data.find((event) => {
      const parsed = event.parsedJson || {};

      return (
        parsed.manager_id === expected.managerId &&
        parsed.oracle_id === expected.oracleId &&
        String(parsed.expiry) === expected.expiry &&
        String(parsed.strike) === expected.strike &&
        Boolean(parsed.is_up) === expected.isUp &&
        String(parsed.quantity) === expected.quantity
      );
    });

    if (match) {
      return match;
    }

    if (!page.hasNextPage) {
      break;
    }

    cursor = page.nextCursor;
  }

  return null;
}

function extractSettlementPrice(...sources) {
  for (const source of sources) {
    const value =
      readNumber(source, ["settlementPrice", "settlement_price"]) ||
      readNumber(source?.data, ["settlementPrice", "settlement_price"]) ||
      readNumber(source?.oracle, ["settlementPrice", "settlement_price"]);

    if (value) {
      return normalizeScaledPrice(value);
    }
  }

  return null;
}

function generateDeepbookResultPost({
  market,
  result,
  settlementPrice,
  winners,
  losers,
  payoutResults,
}) {
  const strike = formatPrice(market.predictStrike || market.targetPrice);
  const expiry = formatUtcDateTime(market.predictExpiry || market.expiryTime);
  const topWinners = winners
    .sort((a, b) => b.payout - a.payout)
    .slice(0, 5)
    .map((winner, index) => `${index + 1}. @${winner.username} ${winner.payout.toFixed(6)} dUSDC`)
    .join("\n");

  const payoutLines = payoutResults
    .slice(0, 5)
    .map(
      (payout) =>
        `@${payout.username}: redeem ${shortDigest(payout.redeemDigest)}, withdraw ${shortDigest(payout.withdrawDigest)}`,
    )
    .join("\n");

  return [
    `Market #${market.marketNumber} settled \n`,
    "",
    `BTC above $${strike} by ${expiry} UTC? \n`,
    "",
    `Closing Price: $${Number(settlementPrice).toFixed(2)}\n`,
    "",
    `Result: ${result}\n`,
    "",
    "Winners",
    topWinners || "No winning positions.\n",
    "\n",
    "Powered by DeepBook Predict on Sui.",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatPrice(price) {
  return Number(price).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
}

function formatUtcDateTime(value) {
  const date = new Date(value);
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${month}-${day} ${hours}:${minutes}`;
}

function shortDigest(digest) {
  if (!digest) {
    return "n/a";
  }

  return `${digest.slice(0, 8)}...${digest.slice(-6)}`;
}

function toPredictPriceUnits(price) {
  return BigInt(Math.round(Number(price) * 1_000_000_000));
}

module.exports = {
  settleDeepbookMarket,
  settleResolvedDeepbookMarkets,
  startDeepbookSettlementWorker,
};
