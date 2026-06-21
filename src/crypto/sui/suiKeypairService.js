const { Ed25519Keypair } = require("@mysten/sui/keypairs/ed25519");

function keypairFromSecretKey(secretKey) {
  if (!secretKey) {
    throw new Error("Missing Sui secret key");
  }

  return Ed25519Keypair.fromSecretKey(secretKey);
}

module.exports = {
  keypairFromSecretKey,
};