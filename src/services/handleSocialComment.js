const { parseOrderCommand } = require("../utils/parseOrderCommand");
const { createDemoWallet } = require("../utils/createDemoWallet");
const { logBotActivity } = require("./botActivity");
const { createSuiWallet } = require("../crypto/sui/suiWalletService");
const { getDusdcBalance } = require("../crypto/sui/suiBalanceService");
const { ensureUserSuiWallet } = require("../crypto/sui/ensureUserSuiWallet");
const { sendSuiForGas } = require("../crypto/sui/suiGasService");
const { transferDusdcToEscrow } = require("../crypto/sui/suiTransferService");
const {
  executeDeepbookPredictMint,
} = require("./deepbookPredictExecutionService");
const {
  PLATFORMS,
  normalizePlatform,
  getUserMention,
  getPlatformLabel,
} = require("../utils/platform");

function getOrderExecutionMode() {
  return process.env.ORDER_EXECUTION_MODE || "DEEPBOOK_PREDICT";
}

async function handleSocialComment({
  prisma,
  platform,
  platformUserId,
  username,
  platformPostId,
  platformCommentId,
  text,
}) {
  const normalizedPlatform = normalizePlatform(platform);
  const mention = getUserMention(normalizedPlatform, username);
  const platformLabel = getPlatformLabel(normalizedPlatform);

  await logBotActivity(
    prisma,
    "COMMENT_DETECTED",
    `${platformLabel} comment detected from ${mention}: ${text}`,
    {
      platform: normalizedPlatform,
      platformUserId,
      username,
      platformPostId,
      platformCommentId,
      text,
    },
  );

  const parsed = parseOrderCommand(text);

  if (!parsed.valid) {
    const reply = `${mention} ${parsed.error}`;

    await logBotActivity(
      prisma,
      "INVALID_COMMAND",
      `Invalid ${platformLabel} command from ${mention}`,
      {
        platform: normalizedPlatform,
        username,
        text,
        error: parsed.error,
        reply,
      },
    );

    return {
      success: false,
      status: "INVALID_COMMAND",
      reply,
    };
  }

  const market = await findMarketByPlatformPostId({
    prisma,
    platform: normalizedPlatform,
    platformPostId,
  });

  if (!market) {
    const reply = `${mention} Market not found.`;

    await logBotActivity(prisma, "MARKET_NOT_FOUND", reply, {
      platform: normalizedPlatform,
      platformPostId,
      platformCommentId,
    });

    return {
      success: false,
      status: "MARKET_NOT_FOUND",
      reply,
    };
  }

  if (market.status !== "OPEN") {
    const reply = `${mention} This market is not open.`;

    await logBotActivity(
      prisma,
      "ORDER_REJECTED",
      `Order rejected for ${mention}: market not open`,
      {
        platform: normalizedPlatform,
        username,
        marketId: market.id,
        marketNumber: market.marketNumber,
        marketStatus: market.status,
        reply,
      },
    );

    return {
      success: false,
      status: "MARKET_NOT_OPEN",
      reply,
    };
  }

  const existingOrder = await prisma.order.findUnique({
    where: {
      sourcePlatform_sourceCommentId: {
        sourcePlatform: normalizedPlatform,
        sourceCommentId: platformCommentId,
      },
    },
  });

  if (existingOrder) {
    const reply = `${mention} This comment has already been processed.`;

    await logBotActivity(
      prisma,
      "DUPLICATE_COMMENT",
      `Duplicate ${platformLabel} comment ignored from ${mention}`,
      {
        platform: normalizedPlatform,
        username,
        platformCommentId,
        existingOrderId: existingOrder.id,
        reply,
      },
    );

    return {
      success: false,
      status: "DUPLICATE_COMMENT",
      reply,
    };
  }

  let user = await prisma.user.findUnique({
    where: {
      platform_platformUserId: {
        platform: normalizedPlatform,
        platformUserId,
      },
    },
  });

  let isNewUser = false;

  if (!user) {
    isNewUser = true;

    const suiWallet = await createSuiWallet();

    user = await prisma.user.create({
      data: {
        platform: normalizedPlatform,
        platformUserId,
        username,

        // Keep old field for UI compatibility.
        walletAddress: suiWallet.address,

        suiAddress: suiWallet.address,
        suiPrivateKey: suiWallet.privateKey,
        suiPublicKey: suiWallet.publicKey,
        cryptoWalletCreated: true,

        // You may keep demoBalance for internal display, but not use it for order validation.
        demoBalance: 0,
      },
    });

    user = await ensureUserSuiWallet({
      prisma,
      user,
      mention,
    });

    console.log("USER AFTER ENSURE SUI WALLET:", {
      id: user.id,
      username: user.username,
      platform: user.platform,
      suiAddress: user.suiAddress,
      walletAddress: user.walletAddress,
      cryptoWalletCreated: user.cryptoWalletCreated,
    });

    await logBotActivity(
      prisma,
      "SUI_WALLET_CREATED",
      `Sui testnet wallet created for ${mention}`,
      {
        platform: normalizedPlatform,
        userId: user.id,
        username: user.username,
        suiAddress: user.suiAddress,
      },
    );

    try {
      const gasFunding = await sendSuiForGas({
        recipientAddress: user.suiAddress,
        amountSui: 0.05,
      });

      await logBotActivity(
        prisma,
        "SUI_GAS_FUNDED",
        `Funded SUI gas for ${mention}`,
        {
          userId: user.id,
          username: user.username,
          suiAddress: user.suiAddress,
          txDigest: gasFunding.digest,
          amountSui: gasFunding.amountSui,
        },
      );
    } catch (gasError) {
      await logBotActivity(
        prisma,
        "SUI_GAS_FUNDING_FAILED",
        `Failed to fund SUI gas for ${mention}`,
        {
          userId: user.id,
          username: user.username,
          suiAddress: user.suiAddress,
          error: gasError.message,
        },
      );
    }
  }

  if (user && !user.suiAddress) {
    const suiWallet = await createSuiWallet();

    user = await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        walletAddress: suiWallet.address,
        suiAddress: suiWallet.address,
        suiPrivateKey: suiWallet.privateKey,
        suiPublicKey: suiWallet.publicKey,
        cryptoWalletCreated: true,
        demoBalance: 0,
      },
    });

    await logBotActivity(
      prisma,
      "SUI_WALLET_BACKFILLED",
      `Sui testnet wallet backfilled for ${mention}`,
      {
        platform: normalizedPlatform,
        userId: user.id,
        username: user.username,
        suiAddress: user.suiAddress,
      },
    );
  }

  const price =
    parsed.side === "YES" ? Number(market.yesPrice) : Number(market.noPrice);

  const amount = parsed.amount;

  if (market.source === "DEEPBOOK_PREDICT") {
    const cutoffSeconds = Number(process.env.DEEPBOOK_ORDER_CUTOFF_SECONDS || 120);
    const timeToExpiryMs =
      new Date(market.predictExpiry || market.expiryTime).getTime() - Date.now();

    if (timeToExpiryMs <= cutoffSeconds * 1000) {
      const reply =
        `${mention} This DeepBook market is too close to expiry for a new mint.\n\n` +
        `DeepBook can reject late orders when the live ask price moves outside protocol bounds.\n` +
        `Please use the newest market post.`;

      await logBotActivity(
        prisma,
        "DEEPBOOK_ORDER_REJECTED",
        `DeepBook order rejected for ${mention}: too close to expiry`,
        {
          platform: normalizedPlatform,
          username,
          marketId: market.id,
          marketNumber: market.marketNumber,
          cutoffSeconds,
          timeToExpiryMs,
          reply,
        },
      );

      return {
        success: false,
        status: "DEEPBOOK_ORDER_TOO_CLOSE_TO_EXPIRY",
        reply,
      };
    }
  }

  if (!user.suiAddress || !user.suiAddress.startsWith("0x")) {
    throw new Error(`Invalid or missing Sui address for user @${username}`);
  }

  const dusdcBalance = await getDusdcBalance(user.suiAddress);

  if (Number(dusdcBalance.totalBalance) < amount) {
    const retryCommand = `${parsed.side === "YES" ? "YES" : "NO"} ${amount} USDC`;
    const reply = buildInsufficientBalanceReply({
      mention,
      normalizedPlatform,
      isNewUser,
      user,
      amount,
      currentBalance: dusdcBalance.totalBalance,
      retryCommand,
    });

    await logBotActivity(
      prisma,
      "ORDER_REJECTED",
      `Order rejected for ${mention}: insufficient real dUSDC balance`,
      {
        platform: normalizedPlatform,
        username,
        amount,
        suiAddress: user.suiAddress,
        dusdcBalance: dusdcBalance.totalBalance,
        reply,
      },
    );

    return {
      success: false,
      status: "INSUFFICIENT_DUSDC_BALANCE",
      reply,
    };
  }

  const potentialPayout = amount / price;

  const updatedUser = await prisma.user.update({
    where: {
      id: user.id,
    },
    data: {
      lastDusdcBalance: dusdcBalance.totalBalanceRaw,
      lastDusdcCheckedAt: new Date(),
    },
  });

  if (
    getOrderExecutionMode() === "DEEPBOOK_PREDICT" &&
    market.source === "DEEPBOOK_PREDICT"
  ) {
    return handleDeepbookPredictOrder({
      prisma,
      normalizedPlatform,
      platformLabel,
      mention,
      username,
      platformPostId,
      platformCommentId,
      parsed,
      user,
      updatedUser,
      market,
      amount,
      price,
      potentialPayout,
      isNewUser,
    });
  }

  if (market.source === "DEEPBOOK_PREDICT") {
    const reply =
      `${mention} This market must execute through DeepBook Predict, but the backend is not in DeepBook mode. ` +
      `No funds were moved.`;

    await logBotActivity(
      prisma,
      "DEEPBOOK_ORDER_REJECTED",
      `DeepBook order rejected for ${mention}: backend not in DeepBook mode`,
      {
        platform: normalizedPlatform,
        username,
        marketId: market.id,
        marketNumber: market.marketNumber,
        orderExecutionMode: getOrderExecutionMode(),
        reply,
      },
    );

    return {
      success: false,
      status: "DEEPBOOK_MODE_REQUIRED",
      reply,
    };
  }

  const escrowAddress = process.env.SUI_ESCROW_ADDRESS;

  let escrowTransfer;

  try {
    escrowTransfer = await transferDusdcToEscrow({
      senderSecretKey: user.suiPrivateKey,
      senderAddress: user.suiAddress,
      recipientAddress: escrowAddress,
      amount,
    });

    await logBotActivity(
      prisma,
      "DUSDC_ESCROW_TRANSFERRED",
      `${mention} escrowed ${amount} dUSDC`,
      {
        platform: normalizedPlatform,
        username,
        suiAddress: user.suiAddress,
        escrowAddress,
        amount,
        amountRaw: escrowTransfer.amountRaw,
        txDigest: escrowTransfer.digest,
      },
    );
  } catch (escrowError) {
    const reply =
      `${mention} Order funding failed ❌\n\n` +
      `Wallet: ${user.suiAddress}\n` +
      `Required: ${amount} dUSDC\n\n` +
      `Reason: ${escrowError.message}\n\n` +
      `Make sure your wallet has dUSDC and a small amount of SUI for gas, then comment again.`;

    await logBotActivity(
      prisma,
      "DUSDC_ESCROW_FAILED",
      `Escrow transfer failed for ${mention}`,
      {
        platform: normalizedPlatform,
        username,
        suiAddress: user.suiAddress,
        escrowAddress,
        amount,
        error: escrowError.message,
        reply,
      },
    );

    return {
      success: false,
      status: "ESCROW_TRANSFER_FAILED",
      reply,
    };
  }

  const order = await prisma.order.create({
    data: {
      userId: user.id,
      marketId: market.id,
      side: parsed.side,
      amount,
      entryPrice: execution.effectivePrice || price,
      potentialPayout: Number(execution.quantityRaw) / 1_000_000,
      sourcePlatform: normalizedPlatform,
      sourcePostId: platformPostId,
      sourceCommentId: platformCommentId,

      fundingStatus: "FUNDED",
      escrowTxDigest: escrowTransfer.digest,
      escrowAddress,
      escrowedAmountRaw: escrowTransfer.amountRaw,
    },
  });

  await logBotActivity(
    prisma,
    "ORDER_PLACED",
    `${mention} placed ${parsed.side} ${amount} dUSDC on Market #${market.marketNumber}`,
    {
      platform: normalizedPlatform,
      orderId: order.id,
      userId: user.id,
      username,
      marketId: market.id,
      marketNumber: market.marketNumber,
      side: parsed.side,
      amount,
      entryPrice: price,
      potentialPayout,
      sourceCommentId: platformCommentId,
    },
  );

  let reply;

  if (isNewUser) {
    reply =
      `${mention} Account created ✅\n\n` +
      `Sui testnet wallet:\n` +
      `${user.suiAddress}\n\n` +
      `Order funded and placed ✅\n` +
      `${parsed.side} ${amount} dUSDC\n` +
      `Potential payout: ${potentialPayout.toFixed(2)} dUSDC\n\n` +
      `Escrow tx:\n${escrowTransfer.digest}`;
  } else {
    reply =
      `${mention} Order funded and placed ✅\n\n` +
      `Market #${market.marketNumber}\n` +
      `${parsed.side} ${amount} dUSDC at ${price}\n` +
      `Potential payout: ${potentialPayout.toFixed(2)} dUSDC\n` +
      `Wallet: ${user.suiAddress}\n` +
      `Escrow tx: ${escrowTransfer.digest}`;
  }

  await logBotActivity(
    prisma,
    "REPLY_GENERATED",
    `${platformLabel} reply generated for ${mention}`,
    {
      platform: normalizedPlatform,
      username,
      platformCommentId,
      reply,
    },
  );

  return {
    success: true,
    status: "ORDER_PLACED",
    isNewUser,
    user: updatedUser,
    order,
    reply,
  };
}

async function handleDeepbookPredictOrder({
  prisma,
  normalizedPlatform,
  platformLabel,
  mention,
  username,
  platformPostId,
  platformCommentId,
  parsed,
  user,
  updatedUser,
  market,
  amount,
  price,
  potentialPayout,
  isNewUser,
}) {
  let execution;

  try {
    execution = await executeDeepbookPredictMint({
      prisma,
      user,
      market,
      side: parsed.side,
      amount,
    });

    await logBotActivity(
      prisma,
      "DEEPBOOK_PREDICT_MINTED",
      `${mention} minted ${parsed.side} ${amount} dUSDC on DeepBook Predict`,
      {
        userId: user.id,
        username,
        marketId: market.id,
        marketNumber: market.marketNumber,
        predictManagerId: execution.managerId,
        predictOracleId: market.predictOracleId,
        side: parsed.side,
        amount,
        quantityRaw: execution.quantityRaw,
        costRaw: execution.costRaw,
        leftoverDepositRaw: execution.leftoverDepositRaw,
        leftoverWithdrawDigest: execution.leftoverWithdrawDigest,
        leftoverWithdrawError: execution.leftoverWithdrawError,
        txDigest: execution.digest,
      },
    );
  } catch (error) {
    const reason = formatDeepbookMintFailure(error.message);
    const reply =
      `${mention} order failed ❌\n\n` +
      `Reason: ${reason}\n\n` +
      "Please check your dUSDC balance and SUI gas, then try again.";

    await logBotActivity(
      prisma,
      "DEEPBOOK_PREDICT_MINT_FAILED",
      `DeepBook Predict mint failed for ${mention}`,
      {
        userId: user.id,
        username,
        marketId: market.id,
        marketNumber: market.marketNumber,
        predictOracleId: market.predictOracleId,
        side: parsed.side,
        amount,
        error: error.message,
        userFacingReason: reason,
        reply,
      },
    );

    return {
      success: false,
      status: "DEEPBOOK_PREDICT_MINT_FAILED",
      reply,
    };
  }

  const order = await prisma.order.create({
    data: {
      userId: user.id,
      marketId: market.id,
      side: parsed.side,
      amount,
      entryPrice: execution.effectivePrice || price,
      potentialPayout: Number(execution.quantityRaw) / 1_000_000,
      sourcePlatform: normalizedPlatform,
      sourcePostId: platformPostId,
      sourceCommentId: platformCommentId,

      fundingStatus: "FUNDED",
      predictManagerId: execution.managerId,
      predictOracleId: market.predictOracleId,
      predictExpiry: market.predictExpiry,
      predictStrike: market.predictStrike,
      predictDirection: parsed.side === "YES" ? "UP" : "DOWN",
      predictMarketKeyJson: {
        ...(market.predictMarketKeyJson || {}),
        isUp: parsed.side === "YES",
      },
      predictMintDigest: execution.digest,
      predictQuantity: execution.quantityRaw,
      predictExecutionStatus: "MINTED",
    },
  });

  const accountPrefix = isNewUser
    ? buildAccountCreatedPrefix({ normalizedPlatform, user })
    : "";
  const strike = formatMarketStrike(market);
  const transactionLine =
    normalizedPlatform === PLATFORMS.X
      ? ""
      : "\nOrder tx:\n" + `${execution.digest}\n\n`;
  const reply =
    `${mention} ${accountPrefix}position minted ✅\n\n` +
    `Market: BTC above $${strike}\n` +
    `Side: ${parsed.side}\n` +
    `Amount: ${amount} dUSDC\n\n` +
    `Estimated Payout: ${formatDusdcBaseUnits(execution.quantityRaw)} dUSDC\n` +
    transactionLine +
    "\nPowered by DeepBook Predict on Sui.";

  await logBotActivity(
    prisma,
    "REPLY_GENERATED",
    `${platformLabel} DeepBook Predict reply generated for ${mention}`,
    {
      platform: normalizedPlatform,
      username,
      platformCommentId,
      reply,
    },
  );

  return {
    success: true,
    status: "DEEPBOOK_PREDICT_ORDER_MINTED",
    isNewUser,
    user: updatedUser,
    order,
    reply,
  };
}

function formatDusdcBaseUnits(value) {
  return (Number(value || 0) / 1_000_000).toFixed(6);
}

function formatDecimal(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "n/a";
  }

  return Number(value).toFixed(6);
}

function buildInsufficientBalanceReply({
  mention,
  normalizedPlatform,
  isNewUser,
  user,
  amount,
  currentBalance,
  retryCommand,
}) {
  if (normalizedPlatform === PLATFORMS.X) {
    if (isNewUser) {
      return (
        `${mention} account created ✅\n\n` +
        "Your custodial Sui testnet wallet is ready.\n\n" +
        "Fund it with dUSDC from your XPredict profile, then reply again:\n\n" +
        `YES ${amount} USDC\n` +
        `NO ${amount} USDC\n\n` +
        "Note: Already funded with Sui for gas"
      );
    }

    return (
      `${mention} balance too low ⚠️\n\n` +
      `Required: ${amount} dUSDC\n` +
      `Current balance: ${currentBalance.toFixed(6)} dUSDC\n\n` +
      "Fund your XPredict Sui testnet wallet, then reply again:\n" +
      retryCommand
    );
  }

  if (isNewUser) {
    return (
      `${mention} account created ✅\n\n` +
      "Your Sui testnet wallet:\n" +
      `${user.suiAddress}\n\n` +
      "Fund this wallet with dUSDC, then reply again:\n\n" +
      `YES ${amount} USDC\n` +
      `NO ${amount} USDC\n\n` +
      "Note: Already funded with Sui for gas"
    );
  }

  return (
    `${mention} balance too low ⚠️\n\n` +
    `Required: ${amount} dUSDC\n` +
    `Current balance: ${currentBalance.toFixed(6)} dUSDC\n\n` +
    "Fund your Sui testnet wallet:\n" +
    `${user.suiAddress}\n\n` +
    "Then reply again:\n" +
    retryCommand
  );
}

function buildAccountCreatedPrefix({ normalizedPlatform, user }) {
  if (normalizedPlatform === PLATFORMS.X) {
    return "account created ✅\n\nYour custodial Sui testnet wallet is ready.\n\n";
  }

  return `account created ✅\n\nYour Sui testnet wallet:\n${user.suiAddress}\n\n`;
}

function formatMarketStrike(market) {
  return Number(market.predictStrike || market.targetPrice).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
}

function formatDustWithdrawLine(execution) {
  const leftoverRaw = BigInt(execution.leftoverDepositRaw || 0);

  if (leftoverRaw <= 0n) {
    return "";
  }

  if (execution.leftoverWithdrawDigest) {
    return (
      `Dust returned: ${formatDusdcBaseUnits(leftoverRaw)} dUSDC\n` +
      `Dust tx: ${execution.leftoverWithdrawDigest}\n`
    );
  }

  return (
    `Dust still in manager: ${formatDusdcBaseUnits(leftoverRaw)} dUSDC\n` +
    `Dust withdraw failed: ${execution.leftoverWithdrawError || "unknown error"}\n`
  );
}

function formatDeepbookMintFailure(message) {
  if (message?.includes("assert_mintable_ask") || message?.includes("EAskPriceOutOfBounds")) {
    return (
      "DeepBook rejected the live quote because the ask price is outside protocol bounds. " +
      "This usually happens when the market is too close to expiry or the strike has moved too far from spot."
    );
  }

  return message;
}

async function findMarketByPlatformPostId({
  prisma,
  platform,
  platformPostId,
}) {
  if (platform === "X") {
    return prisma.market.findUnique({
      where: {
        xPostId: platformPostId,
      },
    });
  }

  if (platform === "REDDIT") {
    return prisma.market.findUnique({
      where: {
        redditPostId: platformPostId,
      },
    });
  }

  if (platform === "XP_SOCIAL") {
    return prisma.market.findUnique({
      where: {
        xpSocialPostId: platformPostId,
      },
    });
  }

  return null;
}

module.exports = {
  handleSocialComment,
};
