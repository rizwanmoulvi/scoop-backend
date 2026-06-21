const PLATFORMS = {
  X: "X",
  REDDIT: "REDDIT",
  XP_SOCIAL: "XP_SOCIAL",
};

function normalizePlatform(platform) {
  const value = String(platform || "").toUpperCase();

  if (value === "X" || value === "TWITTER") {
    return PLATFORMS.X;
  }

  if (value === "REDDIT") {
    return PLATFORMS.REDDIT;
  }

  if (
    value === "XP_SOCIAL" ||
    value === "XPSOCIAL" ||
    value === "MOCK_SOCIAL"
  ) {
    return PLATFORMS.XP_SOCIAL;
  }

  throw new Error("Unsupported platform");
}

function getUserMention(platform, username) {
  if (platform === PLATFORMS.REDDIT) {
    return `u/${username}`;
  }

  return `@${username}`;
}

function getPlatformLabel(platform) {
  if (platform === PLATFORMS.REDDIT) return "Reddit";
  if (platform === PLATFORMS.X) return "X";
  if (platform === PLATFORMS.XP_SOCIAL) return "XP Social";

  return platform;
}

module.exports = {
  PLATFORMS,
  normalizePlatform,
  getUserMention,
  getPlatformLabel,
};