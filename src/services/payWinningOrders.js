const { transferDusdcFromEscrow } = require("../crypto/sui/suiTransferService");
const { logBotActivity } = require("./botActivity");

async function payWinningOrders({ prisma, marketId }) {
  const escrowSecretKey = process.env.SUI_ESCROW_PRIVATE_KEY;
  const escrowAddress = process.env.SUI_ESCROW_ADDRESS;

  if (!escrowSecretKey || !escrowAddress) {
    throw new Error("SUI_ESCROW_PRIVATE_KEY or SUI_ESCROW_ADDRESS missing");
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
    throw new Error("Market not found for payout");
  }

  if (market.status !== "RESOLVED") {
    throw new Error("Market must be RESOLVED before payout");
  }

  const paid = [];
  const failed = [];

  const winningOrders = market.orders.filter(
    (order) =>
      order.status === "WON" &&
      order.fundingStatus === "FUNDED" &&
      order.payoutStatus !== "PAID"
  );

  for (const order of winningOrders) {
    try {
      const payoutAmount = Number(order.potentialPayout);

      if (!order.user.suiAddress) {
        throw new Error("Winner has no Sui address");
      }

      const payout = await transferDusdcFromEscrow({
        escrowSecretKey,
        escrowAddress,
        recipientAddress: order.user.suiAddress,
        amount: payoutAmount,
      });

      const updatedOrder = await prisma.order.update({
        where: {
          id: order.id,
        },
        data: {
          payoutStatus: "PAID",
          payoutTxDigest: payout.digest,
          payoutAmountRaw: payout.amountRaw,
          paidAt: new Date(),
        },
      });

      await logBotActivity(
        prisma,
        "DUSDC_PAYOUT_SENT",
        `Paid ${payoutAmount.toFixed(6)} dUSDC to @${order.user.username}`,
        {
          marketId: market.id,
          marketNumber: market.marketNumber,
          orderId: order.id,
          username: order.user.username,
          recipientAddress: order.user.suiAddress,
          payoutAmount,
          payoutAmountRaw: payout.amountRaw,
          txDigest: payout.digest,
        }
      );

      paid.push({
        orderId: order.id,
        username: order.user.username,
        amount: payoutAmount,
        txDigest: payout.digest,
        order: updatedOrder,
      });
    } catch (error) {
      await prisma.order.update({
        where: {
          id: order.id,
        },
        data: {
          payoutStatus: "FAILED",
        },
      });

      await logBotActivity(
        prisma,
        "DUSDC_PAYOUT_FAILED",
        `Payout failed for @${order.user.username}`,
        {
          marketId: market.id,
          marketNumber: market.marketNumber,
          orderId: order.id,
          username: order.user.username,
          error: error.message,
        }
      );

      failed.push({
        orderId: order.id,
        username: order.user.username,
        error: error.message,
      });
    }
  }

  return {
    paid,
    failed,
  };
}

module.exports = {
  payWinningOrders,
};