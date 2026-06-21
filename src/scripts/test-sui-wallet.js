const { createSuiWallet } = require("../crypto/sui/suiWalletService");

async function main() {
  const wallet = await createSuiWallet();

  console.log("Sui wallet created successfully");
  console.log("Address:", wallet.address);
  console.log("Public key:", wallet.publicKey);
  console.log("Private key:", wallet.privateKey);

  if (!wallet.address || !wallet.address.startsWith("0x")) {
    throw new Error("Invalid Sui address generated");
  }

  if (!wallet.privateKey) {
    throw new Error("Private key was not generated/exported");
  }
}

main().catch((error) => {
  console.error("Sui wallet test failed:", error);
});