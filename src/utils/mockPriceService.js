function getMockPrice(asset) {
  const prices = {
    BTC: 72500,
    ETH: 3800,
    SOL: 165,
  };

  return prices[asset.toUpperCase()] || 100;
}

module.exports = {
  getMockPrice,
};