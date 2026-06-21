const { SuiClient, getFullnodeUrl } = require("@mysten/sui/client");

function createSuiClient() {
  const rpcUrl =
    process.env.SUI_RPC_URL ||
    getFullnodeUrl(process.env.SUI_NETWORK || "testnet");

  return new SuiClient({
    url: rpcUrl,
  });
}

module.exports = {
  createSuiClient,
};