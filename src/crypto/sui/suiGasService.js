const { Transaction } = require("@mysten/sui/transactions");
const { createSuiClient } = require("./suiClient");
const { keypairFromSecretKey } = require("./suiKeypairService");

function toMist(suiAmount) {
  return BigInt(Math.floor(Number(suiAmount) * 1_000_000_000));
}

async function sendSuiForGas({ recipientAddress, amountSui = 0.05 }) {
  const sponsorSecretKey = process.env.SUI_BOT_PRIVATE_KEY;

  if (!sponsorSecretKey) {
    throw new Error("SUI_BOT_PRIVATE_KEY is missing");
  }

  const client = createSuiClient();
  const sponsorKeypair = keypairFromSecretKey(sponsorSecretKey);
  const sponsorAddress = sponsorKeypair.getPublicKey().toSuiAddress();

  const tx = new Transaction();

  tx.setSender(sponsorAddress);

  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(toMist(amountSui).toString())]);

  tx.transferObjects([coin], tx.pure.address(recipientAddress));

  const result = await client.signAndExecuteTransaction({
    signer: sponsorKeypair,
    transaction: tx,
    options: {
      showEffects: true,
      showBalanceChanges: true,
    },
  });

  if (result.effects?.status?.status !== "success") {
    throw new Error(
      result.effects?.status?.error || "SUI gas funding transaction failed"
    );
  }

  return {
    digest: result.digest,
    sponsorAddress,
    recipientAddress,
    amountSui,
    result,
  };
}

module.exports = {
  sendSuiForGas,
};