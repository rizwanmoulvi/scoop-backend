const { Transaction } = require("@mysten/sui/transactions");
const { createSuiClient } = require("./suiClient");
const { keypairFromSecretKey } = require("./suiKeypairService");
const { DUSDC_COIN_TYPE, toDusdcBaseUnits } = require("./suiBalanceService");

async function transferDusdcToEscrow({
  senderSecretKey,
  senderAddress,
  recipientAddress,
  amount,
}) {
  if (!recipientAddress) {
    throw new Error("Missing escrow recipient address");
  }

  const client = createSuiClient();
  const senderKeypair = keypairFromSecretKey(senderSecretKey);

  const amountRaw = toDusdcBaseUnits(amount);

  const coins = await client.getCoins({
    owner: senderAddress,
    coinType: DUSDC_COIN_TYPE,
  });

  if (!coins.data.length) {
    throw new Error("No dUSDC coin objects found in user wallet");
  }

  let selectedCoins = [];
  let selectedTotal = 0n;

  for (const coin of coins.data) {
    selectedCoins.push(coin);
    selectedTotal += BigInt(coin.balance);

    if (selectedTotal >= amountRaw) {
      break;
    }
  }

  if (selectedTotal < amountRaw) {
    throw new Error("Insufficient dUSDC coin object balance");
  }

  const tx = new Transaction();

  tx.setSender(senderAddress);

  const primaryCoin = tx.object(selectedCoins[0].coinObjectId);

  if (selectedCoins.length > 1) {
    tx.mergeCoins(
      primaryCoin,
      selectedCoins.slice(1).map((coin) => tx.object(coin.coinObjectId)),
    );
  }

  const [paymentCoin] = tx.splitCoins(primaryCoin, [
    tx.pure.u64(amountRaw.toString()),
  ]);

  tx.transferObjects([paymentCoin], tx.pure.address(recipientAddress));

  const result = await client.signAndExecuteTransaction({
    signer: senderKeypair,
    transaction: tx,
    options: {
      showEffects: true,
      showObjectChanges: true,
      showBalanceChanges: true,
    },
  });

  if (result.effects?.status?.status !== "success") {
    throw new Error(
      result.effects?.status?.error || "dUSDC transfer transaction failed",
    );
  }

  return {
    digest: result.digest,
    amountRaw: amountRaw.toString(),
    result,
  };
}

async function transferDusdcFromEscrow({
    escrowSecretKey,
    escrowAddress,
    recipientAddress,
    amount,
  }) {
    if (!escrowSecretKey) {
      throw new Error("Missing escrow secret key");
    }

    if (!escrowAddress) {
      throw new Error("Missing escrow address");
    }

    if (!recipientAddress) {
      throw new Error("Missing payout recipient address");
    }

    const client = createSuiClient();
    const escrowKeypair = keypairFromSecretKey(escrowSecretKey);

    const amountRaw = toDusdcBaseUnits(amount);

    const coins = await client.getCoins({
      owner: escrowAddress,
      coinType: DUSDC_COIN_TYPE,
    });

    if (!coins.data.length) {
      throw new Error("No dUSDC coin objects found in escrow wallet");
    }

    let selectedCoins = [];
    let selectedTotal = 0n;

    for (const coin of coins.data) {
      selectedCoins.push(coin);
      selectedTotal += BigInt(coin.balance);

      if (selectedTotal >= amountRaw) {
        break;
      }
    }

    if (selectedTotal < amountRaw) {
      throw new Error("Insufficient dUSDC liquidity in escrow wallet");
    }

    const tx = new Transaction();

    tx.setSender(escrowAddress);

    const primaryCoin = tx.object(selectedCoins[0].coinObjectId);

    if (selectedCoins.length > 1) {
      tx.mergeCoins(
        primaryCoin,
        selectedCoins.slice(1).map((coin) => tx.object(coin.coinObjectId)),
      );
    }

    const [payoutCoin] = tx.splitCoins(primaryCoin, [
      tx.pure.u64(amountRaw.toString()),
    ]);

    tx.transferObjects([payoutCoin], tx.pure.address(recipientAddress));

    const result = await client.signAndExecuteTransaction({
      signer: escrowKeypair,
      transaction: tx,
      options: {
        showEffects: true,
        showObjectChanges: true,
        showBalanceChanges: true,
      },
    });

    if (result.effects?.status?.status !== "success") {
      throw new Error(
        result.effects?.status?.error || "dUSDC payout transaction failed",
      );
    }

    return {
      digest: result.digest,
      amountRaw: amountRaw.toString(),
      result,
    };
  }

module.exports = {
  transferDusdcToEscrow,
  transferDusdcFromEscrow,
};
