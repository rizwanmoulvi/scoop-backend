const axios = require("axios");

async function getBitcoinPriceUsd() {
  try {
    const res = await axios.get("https://api.binance.com/api/v3/ticker/price", {
      params: {
        symbol: "BTCUSDT",
      },
      timeout: 10000,
    });

    const price = Number(res.data.price);

    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("Invalid BTC price from Binance");
    }

    return {
      price,
      source: "BINANCE",
      symbol: "BTCUSDT",
      fetchedAt: new Date(),
      raw: res.data,
    };
  } catch (error) {
    throw new Error(`Failed to fetch BTC price: ${error.message}`);
  }
}

module.exports = {
  getBitcoinPriceUsd,
};