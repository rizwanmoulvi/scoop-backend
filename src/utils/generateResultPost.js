function generateResultPost({ market, result, winners, losers }) {
  const topWinners = winners
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 5)
    .map(
      (w, index) =>
        `${index + 1}. @${w.username} +${w.profit.toFixed(2)} dUSDC`
    )
    .join("\n");

  const resolvedPriceText = market.resolvedPrice
    ? `Resolved price: $${Number(market.resolvedPrice).toFixed(2)}\n\n`
    : "";

  return (
    `Market #${market.marketNumber} resolved ✅\n\n` +
    `${market.question}\n\n` +
    `${resolvedPriceText}` +
    `Result: ${result}\n\n` +
    `Winners: ${winners.length}\n` +
    `Losers: ${losers.length}\n\n` +
    `${topWinners ? `Top winners:\n${topWinners}` : "No winners this round."}\n\n` +
    `Demo only. No real money.`
  );
}

module.exports = {
  generateResultPost,
};