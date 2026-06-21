function generateMarketPost(market) {
  const expiry = new Date(market.expiryTime);

  const expiryTime = `${String(expiry.getUTCHours()).padStart(2, "0")}:${String(
    expiry.getUTCMinutes()
  ).padStart(2, "0")}`;

  return (
    `XPredict Market #${market.marketNumber}\n\n` +
    `${market.question}\n\n` +
    `YES → ${Number(market.yesPrice).toFixed(2)} dUSDC\n` +
    `NO  → ${Number(market.noPrice).toFixed(2)} dUSDC\n\n` +
    `Reply before expiry:\n` +
    `Yes 5 USDC\n` +
    `No 5 USDC\n\n` +
    `Expires: ${expiryTime} UTC\n\n` +
    `Demo only. No real money.`
  );
}

module.exports = {
  generateMarketPost,
};