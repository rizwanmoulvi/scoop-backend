const { createSuiWallet } = require("./suiWalletService");
const { logBotActivity } = require("../../services/botActivity");

async function ensureUserSuiWallet({ prisma, user, mention }) {
  if (user.suiAddress && user.suiAddress.startsWith("0x")) {
    return user;
  }

  const suiWallet = await createSuiWallet();

  const updatedUser = await prisma.user.update({
    where: {
      id: user.id,
    },
    data: {
      walletAddress: suiWallet.address,
      suiAddress: suiWallet.address,
      suiPrivateKey: suiWallet.privateKey,
      suiPublicKey: suiWallet.publicKey,
      cryptoWalletCreated: true,
      demoBalance: 0,
    },
  });

  await logBotActivity(
    prisma,
    "SUI_WALLET_CREATED",
    `Sui testnet wallet created/backfilled for ${mention}`,
    {
      userId: updatedUser.id,
      username: updatedUser.username,
      platform: updatedUser.platform,
      suiAddress: updatedUser.suiAddress,
    }
  );

  return updatedUser;
}

module.exports = {
  ensureUserSuiWallet,
};