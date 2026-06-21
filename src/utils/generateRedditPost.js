function generateRedditPost(market) {
  const expiry = new Date(market.expiryTime);

  const timeText = expiry.toLocaleString("en-US", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    day: "2-digit",
    month: "short",
  });

  const title = `XPredict Market #${market.marketNumber}: ${market.question}`;

  const body =
    `${market.question}\n\n` +
    `YES → ${Number(market.yesPrice).toFixed(2)} dUSDC\n\n` +
    `NO → ${Number(market.noPrice).toFixed(2)} dUSDC\n\n` +
    `Reply before expiry with:\n\n` +
    `\`Yes 5 USDC\`\n\n` +
    `or\n\n` +
    `\`No 5 USDC\`\n\n` +
    `Expires: ${timeText} UTC\n\n` +
    `Demo only. No real money. No crypto movement.`;

  return {
    title,
    body,
  };
}

module.exports = {
  generateRedditPost,
};