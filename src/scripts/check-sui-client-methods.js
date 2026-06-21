require("dotenv").config();

const { createSuiClient } = require("../crypto/sui/suiClient");

async function main() {
  const client = await createSuiClient();

  console.log("Client prototype methods:");
  console.log(
    Object.getOwnPropertyNames(Object.getPrototypeOf(client))
  );
}

main().catch(console.error);