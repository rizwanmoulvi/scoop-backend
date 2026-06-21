async function createSuiWallet() {
  const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");

  const keypair = new Ed25519Keypair();

  const address = keypair.getPublicKey().toSuiAddress();
  const privateKey = keypair.getSecretKey();
  const publicKey = keypair.getPublicKey().toBase64();

  return {
    address,
    privateKey,
    publicKey,
  };
}

module.exports = {
  createSuiWallet,
};