const crypto = require("crypto");

function createDemoWallet({ platform, username }) {
  const random = crypto.randomBytes(4).toString("hex");
  const cleanUsername = String(username).replace(/[^a-zA-Z0-9_]/g, "");

  return `xp_${platform.toLowerCase()}_${cleanUsername}_${random}`;
}

module.exports = {
  createDemoWallet,
};