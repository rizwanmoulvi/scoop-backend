const { Ed25519Keypair } = require("@mysten/sui/keypairs/ed25519");

const keypair = new Ed25519Keypair();

console.log("SUI_BOT_ADDRESS=", keypair.getPublicKey().toSuiAddress());
console.log("SUI_BOT_PRIVATE_KEY=", keypair.getSecretKey());