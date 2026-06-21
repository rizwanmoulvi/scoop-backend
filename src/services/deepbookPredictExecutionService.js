const { Transaction } = require("@mysten/sui/transactions");
const { createSuiClient } = require("../crypto/sui/suiClient");
const { keypairFromSecretKey } = require("../crypto/sui/suiKeypairService");
const { toDusdcBaseUnits } = require("../crypto/sui/suiBalanceService");
const { getDeepbookPredictConfig } = require("../config/deepbookPredict");

const SUI_CLOCK_OBJECT_ID = "0x6";
const PRICE_SCALING = 1_000_000_000;
const DUSDC_BASE_UNIT = 1_000_000n;

async function executeDeepbookPredictMint({
  prisma,
  user,
  market,
  side,
  amount,
}) {
  if (!market.predictOracleId || !market.predictExpiry || !market.predictStrike) {
    throw new Error("Market is missing DeepBook Predict metadata");
  }

  if (!user.suiPrivateKey || !user.suiAddress) {
    throw new Error("User is missing a custodial Sui wallet");
  }

  const config = getDeepbookPredictConfig();
  const client = createSuiClient();
  const signer = keypairFromSecretKey(user.suiPrivateKey);

  const managerId =
    user.predictManagerId ||
    (await createPredictManager({
      client,
      signer,
      userAddress: user.suiAddress,
      packageId: config.packageId,
    }));

  if (!user.predictManagerId) {
    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        predictManagerId: managerId,
      },
    });
  }

  const amountRaw = toDusdcBaseUnits(amount);
  const quoteQuantityRaw = amountRaw < DUSDC_BASE_UNIT ? amountRaw : DUSDC_BASE_UNIT;
  const quote = await quoteMintCost({
    client,
    userAddress: user.suiAddress,
    packageId: config.packageId,
    predictObjectId: config.objectId,
    oracleId: market.predictOracleId,
    managerId,
    dusdcCoinType: config.dusdcCoinType,
    amountRaw,
    quantityRaw: quoteQuantityRaw,
    expiryMs: BigInt(new Date(market.predictExpiry).getTime()),
    strikeRaw: toPredictPriceUnits(market.predictStrike),
    isUp: side === "YES",
  });
  const quantityRaw = calculateMaxQuantityRaw({
    amountRaw,
    quoteQuantityRaw,
    askPriceRaw: quote.askPriceRaw,
    quoteCostRaw: quote.costRaw,
    bufferBps: Number(process.env.DEEPBOOK_MINT_QUANTITY_BUFFER_BPS || 100),
  });

  if (quantityRaw <= 0n) {
    throw new Error("DeepBook quote produced a zero position quantity");
  }

  const mint = await depositAndMint({
    client,
    signer,
    userAddress: user.suiAddress,
    packageId: config.packageId,
    predictObjectId: config.objectId,
    oracleId: market.predictOracleId,
    managerId,
    dusdcCoinType: config.dusdcCoinType,
    amountRaw,
    quantityRaw,
    expiryMs: BigInt(new Date(market.predictExpiry).getTime()),
    strikeRaw: toPredictPriceUnits(market.predictStrike),
    isUp: side === "YES",
  });
  const leftoverWithdraw = await withdrawMintRemainder({
    client,
    signer,
    userAddress: user.suiAddress,
    packageId: config.packageId,
    managerId,
    dusdcCoinType: config.dusdcCoinType,
    amountRaw,
    costRaw: mint.costRaw,
    mintDigest: mint.digest,
  });

  return {
    managerId,
    digest: mint.digest,
    quantityRaw: quantityRaw.toString(),
    amountRaw: amountRaw.toString(),
    costRaw: mint.costRaw,
    effectivePrice: mint.effectivePrice,
    quotedCostRaw: quote.costRaw,
    quotedAskPriceRaw: quote.askPriceRaw,
    leftoverDepositRaw: leftoverWithdraw.amountRaw,
    leftoverWithdrawDigest: leftoverWithdraw.digest,
    leftoverWithdrawError: leftoverWithdraw.error,
  };
}

async function executeDeepbookPredictRedeem({
  prisma,
  order,
  user = order.user,
  market = order.market,
}) {
  if (!order.predictManagerId || !order.predictQuantity) {
    throw new Error("Order is missing DeepBook Predict redeem metadata");
  }

  if (!market?.predictOracleId || !market.predictExpiry || !market.predictStrike) {
    throw new Error("Market is missing DeepBook Predict metadata");
  }

  if (!user?.suiPrivateKey || !user.suiAddress) {
    throw new Error("User is missing a custodial Sui wallet");
  }

  const config = getDeepbookPredictConfig();
  const client = createSuiClient();
  const signer = keypairFromSecretKey(user.suiPrivateKey);
  const quantityRaw = BigInt(order.predictQuantity);

  const digest = await redeemPermissionless({
    client,
    signer,
    userAddress: user.suiAddress,
    packageId: config.packageId,
    predictObjectId: config.objectId,
    oracleId: market.predictOracleId,
    managerId: order.predictManagerId,
    dusdcCoinType: config.dusdcCoinType,
    quantityRaw,
    expiryMs: BigInt(new Date(market.predictExpiry).getTime()),
    strikeRaw: toPredictPriceUnits(market.predictStrike),
    isUp: order.side === "YES",
  });

  if (prisma) {
    await prisma.order.update({
      where: {
        id: order.id,
      },
      data: {
        predictRedeemDigest: digest,
        predictRedeemStatus: "REDEEMED",
      },
    });
  }

  return {
    digest,
    quantityRaw: quantityRaw.toString(),
  };
}

async function executeDeepbookPredictWithdraw({
  user,
  amount,
  amountRaw,
  managerId = user?.predictManagerId,
}) {
  if (!managerId) {
    throw new Error("User is missing a PredictManager id");
  }

  if (!user?.suiPrivateKey || !user.suiAddress) {
    throw new Error("User is missing a custodial Sui wallet");
  }

  const withdrawAmountRaw =
    amountRaw !== undefined ? BigInt(amountRaw) : toDusdcBaseUnits(amount);

  if (withdrawAmountRaw <= 0n) {
    throw new Error("Withdraw amount must be greater than zero");
  }

  const config = getDeepbookPredictConfig();
  const client = createSuiClient();
  const signer = keypairFromSecretKey(user.suiPrivateKey);

  const digest = await withdrawFromManager({
    client,
    signer,
    userAddress: user.suiAddress,
    packageId: config.packageId,
    managerId,
    dusdcCoinType: config.dusdcCoinType,
    amountRaw: withdrawAmountRaw,
  });

  return {
    digest,
    managerId,
    amountRaw: withdrawAmountRaw.toString(),
  };
}

async function createPredictManager({ client, signer, userAddress, packageId }) {
  const tx = new Transaction();
  tx.setSender(userAddress);

  tx.moveCall({
    target: `${packageId}::predict::create_manager`,
    arguments: [],
  });

  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
  });

  assertSuccess(result, "DeepBook Predict manager creation failed");

  await client.waitForTransaction({
    digest: result.digest,
  });

  const managerId = findPredictManagerId(result);

  if (!managerId) {
    throw new Error("Could not locate PredictManager object id in transaction result");
  }

  return managerId;
}

async function depositAndMint({
  client,
  signer,
  userAddress,
  packageId,
  predictObjectId,
  oracleId,
  managerId,
  dusdcCoinType,
  amountRaw,
  quantityRaw,
  expiryMs,
  strikeRaw,
  isUp,
}) {
  const coins = await client.getCoins({
    owner: userAddress,
    coinType: dusdcCoinType,
  });

  const selectedCoins = selectCoins(coins.data, amountRaw);
  const tx = buildDepositAndMintTransaction({
    userAddress,
    packageId,
    predictObjectId,
    oracleId,
    managerId,
    dusdcCoinType,
    selectedCoins,
    amountRaw,
    quantityRaw,
    expiryMs,
    strikeRaw,
    isUp,
  });

  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
      showBalanceChanges: true,
    },
  });

  assertSuccess(result, "DeepBook Predict mint failed");

  const mintEvent = findPositionMintedEvent(result);

  return {
    digest: result.digest,
    costRaw: mintEvent?.cost ? String(mintEvent.cost) : amountRaw.toString(),
    effectivePrice:
      mintEvent?.ask_price !== undefined
        ? Number(mintEvent.ask_price) / PRICE_SCALING
        : Number(amountRaw) / Number(quantityRaw),
  };
}

async function quoteMintCost({
  client,
  userAddress,
  packageId,
  predictObjectId,
  oracleId,
  managerId,
  dusdcCoinType,
  amountRaw,
  quantityRaw,
  expiryMs,
  strikeRaw,
  isUp,
}) {
  const coins = await client.getCoins({
    owner: userAddress,
    coinType: dusdcCoinType,
  });

  const selectedCoins = selectCoins(coins.data, amountRaw);
  const tx = buildDepositAndMintTransaction({
    userAddress,
    packageId,
    predictObjectId,
    oracleId,
    managerId,
    dusdcCoinType,
    selectedCoins,
    amountRaw,
    quantityRaw,
    expiryMs,
    strikeRaw,
    isUp,
  });

  const result = await client.devInspectTransactionBlock({
    sender: userAddress,
    transactionBlock: tx,
  });

  if (result.effects?.status?.status !== "success") {
    throw new Error(
      result.effects?.status?.error ||
        result.error ||
        "DeepBook Predict quote failed",
    );
  }

  const mintEvent = findPositionMintedEvent(result);

  if (!mintEvent?.ask_price || !mintEvent?.cost) {
    throw new Error("DeepBook Predict quote did not return an ask price");
  }

  return {
    askPriceRaw: String(mintEvent.ask_price),
    costRaw: String(mintEvent.cost),
  };
}

function buildDepositAndMintTransaction({
  userAddress,
  packageId,
  predictObjectId,
  oracleId,
  managerId,
  dusdcCoinType,
  selectedCoins,
  amountRaw,
  quantityRaw,
  expiryMs,
  strikeRaw,
  isUp,
}) {
  const tx = new Transaction();
  tx.setSender(userAddress);

  const primaryCoin = tx.object(selectedCoins[0].coinObjectId);

  if (selectedCoins.length > 1) {
    tx.mergeCoins(
      primaryCoin,
      selectedCoins.slice(1).map((coin) => tx.object(coin.coinObjectId)),
    );
  }

  const [depositCoin] = tx.splitCoins(primaryCoin, [
    tx.pure.u64(amountRaw.toString()),
  ]);

  tx.moveCall({
    target: `${packageId}::predict_manager::deposit`,
    typeArguments: [dusdcCoinType],
    arguments: [tx.object(managerId), depositCoin],
  });

  const marketKey = tx.moveCall({
    target: `${packageId}::market_key::new`,
    arguments: [
      tx.pure.id(oracleId),
      tx.pure.u64(expiryMs.toString()),
      tx.pure.u64(strikeRaw.toString()),
      tx.pure.bool(isUp),
    ],
  });

  tx.moveCall({
    target: `${packageId}::predict::mint`,
    typeArguments: [dusdcCoinType],
    arguments: [
      tx.object(predictObjectId),
      tx.object(managerId),
      tx.object(oracleId),
      marketKey,
      tx.pure.u64(quantityRaw.toString()),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });

  return tx;
}

function calculateMaxQuantityRaw({
  amountRaw,
  quoteQuantityRaw,
  askPriceRaw,
  quoteCostRaw,
  bufferBps = 0,
}) {
  const askPrice = BigInt(askPriceRaw || 0);
  const multiplierBps = BigInt(Math.max(0, 10_000 - bufferBps));

  if (askPrice > 0n) {
    return (amountRaw * BigInt(PRICE_SCALING) * multiplierBps) / (askPrice * 10_000n);
  }

  const quoteCost = BigInt(quoteCostRaw || 0);

  if (quoteCost > 0n) {
    return (amountRaw * quoteQuantityRaw * multiplierBps) / (quoteCost * 10_000n);
  }

  return 0n;
}

function findPositionMintedEvent(result) {
  return result.events
    ?.map((event) => event.parsedJson)
    .find((event) => event?.quantity && event?.cost && event?.ask_price);
}

async function withdrawMintRemainder({
  client,
  signer,
  userAddress,
  packageId,
  managerId,
  dusdcCoinType,
  amountRaw,
  costRaw,
  mintDigest,
}) {
  const leftoverRaw = amountRaw - BigInt(costRaw || 0);

  if (leftoverRaw <= 0n || process.env.DEEPBOOK_WITHDRAW_MINT_DUST === "false") {
    return {
      amountRaw: "0",
      digest: null,
      error: null,
    };
  }

  try {
    await client.waitForTransaction({
      digest: mintDigest,
    });

    const digest = await withdrawFromManager({
      client,
      signer,
      userAddress,
      packageId,
      managerId,
      dusdcCoinType,
      amountRaw: leftoverRaw,
    });

    return {
      amountRaw: leftoverRaw.toString(),
      digest,
      error: null,
    };
  } catch (error) {
    return {
      amountRaw: leftoverRaw.toString(),
      digest: null,
      error: error.message,
    };
  }
}

async function withdrawFromManager({
  client,
  signer,
  userAddress,
  packageId,
  managerId,
  dusdcCoinType,
  amountRaw,
}) {
  const tx = new Transaction();
  tx.setSender(userAddress);

  const withdrawCoin = tx.moveCall({
    target: `${packageId}::predict_manager::withdraw`,
    typeArguments: [dusdcCoinType],
    arguments: [
      tx.object(managerId),
      tx.pure.u64(amountRaw.toString()),
    ],
  });

  tx.transferObjects([withdrawCoin], tx.pure.address(userAddress));

  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
      showBalanceChanges: true,
    },
  });

  assertSuccess(result, "DeepBook Predict manager withdraw failed");

  return result.digest;
}

async function redeemPermissionless({
  client,
  signer,
  userAddress,
  packageId,
  predictObjectId,
  oracleId,
  managerId,
  dusdcCoinType,
  quantityRaw,
  expiryMs,
  strikeRaw,
  isUp,
}) {
  const tx = new Transaction();
  tx.setSender(userAddress);

  const marketKey = tx.moveCall({
    target: `${packageId}::market_key::new`,
    arguments: [
      tx.pure.id(oracleId),
      tx.pure.u64(expiryMs.toString()),
      tx.pure.u64(strikeRaw.toString()),
      tx.pure.bool(isUp),
    ],
  });

  tx.moveCall({
    target: `${packageId}::predict::redeem_permissionless`,
    typeArguments: [dusdcCoinType],
    arguments: [
      tx.object(predictObjectId),
      tx.object(managerId),
      tx.object(oracleId),
      marketKey,
      tx.pure.u64(quantityRaw.toString()),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });

  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
      showBalanceChanges: true,
    },
  });

  assertSuccess(result, "DeepBook Predict redeem failed");

  return result.digest;
}

function selectCoins(coins, amountRaw) {
  if (!coins.length) {
    throw new Error("No dUSDC coin objects found in user wallet");
  }

  const selected = [];
  let selectedTotal = 0n;

  for (const coin of coins) {
    selected.push(coin);
    selectedTotal += BigInt(coin.balance);

    if (selectedTotal >= amountRaw) {
      return selected;
    }
  }

  throw new Error("Insufficient dUSDC coin object balance");
}

function findPredictManagerId(result) {
  const eventManagerId = result.events
    ?.map((event) => event.parsedJson?.manager_id)
    .find(Boolean);

  if (eventManagerId) {
    return eventManagerId;
  }

  return result.objectChanges
    ?.find((change) => change.type === "created" && change.objectType?.includes("::predict_manager::PredictManager"))
    ?.objectId;
}

function assertSuccess(result, message) {
  if (result.effects?.status?.status !== "success") {
    throw new Error(result.effects?.status?.error || message);
  }
}

function toPredictPriceUnits(price) {
  return BigInt(Math.round(Number(price) * PRICE_SCALING));
}

module.exports = {
  executeDeepbookPredictMint,
  executeDeepbookPredictRedeem,
  executeDeepbookPredictWithdraw,
  toPredictPriceUnits,
};
