const { generateResultPost } = require("../utils/generateResultPost");

async function resolveMarket({ prisma, marketId, result, resolvedPrice }) {
  if (!["YES", "NO"].includes(result)) {
    throw new Error("Result must be YES or NO");
  }

  const market = await prisma.market.findUnique({
    where: {
      id: marketId,
    },
    include: {
      orders: {
        include: {
          user: true,
        },
      },
    },
  });

  if (!market) {
    throw new Error("Market not found");
  }

  if (market.status === "RESOLVED") {
    throw new Error("Market already resolved");
  }

  if (!["OPEN", "EXPIRED"].includes(market.status)) {
    throw new Error(`Market cannot be resolved from status ${market.status}`);
  }

  const winners = [];
  const losers = [];

  for (const order of market.orders) {
    if (order.side === result) {
      await prisma.user.update({
        where: {
          id: order.userId,
        },
        data: {
          demoBalance: {
            increment: Number(order.potentialPayout),
          },
        },
      });

      await prisma.order.update({
        where: {
          id: order.id,
        },
        data: {
          status: "WON",
        },
      });

      winners.push({
        username: order.user.username,
        payout: Number(order.potentialPayout),
        profit: Number(order.potentialPayout) - Number(order.amount),
      });
    } else {
      await prisma.order.update({
        where: {
          id: order.id,
        },
        data: {
          status: "LOST",
        },
      });

      losers.push({
        username: order.user.username,
        lost: Number(order.amount),
      });
    }
  }

  const marketForResultPost = {
    ...market,
    resolvedPrice: resolvedPrice || null,
  };

  const resultPost = generateResultPost({
    market: marketForResultPost,
    result,
    winners,
    losers,
  });

  const updatedMarket = await prisma.market.update({
    where: {
      id: marketId,
    },
    data: {
      status: "RESOLVED",
      result,
      resolvedPrice: resolvedPrice || null,
      resolvedAt: new Date(),
      resultPost,
    },
  });

  return {
    market: updatedMarket,
    winners,
    losers,
    resultPost,
  };
}

module.exports = {
  resolveMarket,
};
