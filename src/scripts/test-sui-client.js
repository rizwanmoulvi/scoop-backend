require("dotenv").config();

const { createSuiClient } = require("../crypto/sui/suiClient");

async function main() {
  const client = await createSuiClient();

  console.log("Connected to Sui JSON-RPC client");

  // Random empty address format for method test.
  // Replace this with your own Sui address if you want.
  const address =
    "0x0000000000000000000000000000000000000000000000000000000000000000";

  const balance = await client.getBalance({
    owner: address,
  });

  console.log("SUI balance result:", balance);
}

main().catch((error) => {
  console.error("Sui test failed:", error);
});