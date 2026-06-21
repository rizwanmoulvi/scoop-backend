const { createSuiClient } = require("./suiClient");

const DUSDC_COIN_TYPE =
  process.env.DUSDC_COIN_TYPE ||
  "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC";

function normalizeDusdcAmount(rawBalance, decimals = 6) {
  return Number(rawBalance) / 10 ** decimals;
}

function toDusdcBaseUnits(amount, decimals = 6) {
  return BigInt(Math.floor(Number(amount) * 10 ** decimals));
}

async function getDusdcBalance(address) {
  const client = await createSuiClient();

  const balance = await client.getBalance({
    owner: address,
    coinType: DUSDC_COIN_TYPE,
  });

  return {
    coinType: DUSDC_COIN_TYPE,
    totalBalanceRaw: balance.totalBalance,
    totalBalance: normalizeDusdcAmount(balance.totalBalance),
  };
}

async function getSuiBalance(address) {
  const client = await createSuiClient();

  const balance = await client.getBalance({
    owner: address,
  });

  return {
    totalBalanceRaw: balance.totalBalance,
    totalBalance: Number(balance.totalBalance) / 1_000_000_000,
  };
}

module.exports = {
  DUSDC_COIN_TYPE,
  getDusdcBalance,
  getSuiBalance,
  normalizeDusdcAmount,
  toDusdcBaseUnits,
};