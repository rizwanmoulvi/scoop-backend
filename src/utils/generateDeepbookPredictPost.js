function generateDeepbookPredictPost(market) {
  const strike = formatPrice(market.predictStrike || market.targetPrice);
  const expiry = formatUtcDateTime(market.predictExpiry || market.expiryTime);
  const amount = process.env.DEEPBOOK_POST_EXAMPLE_AMOUNT || "1";

  return [
    `DeepBook Predict Market #${market.marketNumber}`,
    "",
    `BTC above $${strike} by ${expiry} UTC?`,
    "",
    "Reply to mint a position:",
    "",
    `YES ${amount} USDC`,
    `NO ${amount} USDC`,
    "",
    "Runs on DeepBook Predict, Sui testnet.",
    "Quote asset: dUSDC",
  ].join("\n");
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

module.exports = {
  generateDeepbookPredictPost,
};
