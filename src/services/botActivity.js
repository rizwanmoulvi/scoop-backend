async function logBotActivity(prisma, type, message, metadata = {}) {
  try {
    return await prisma.botActivity.create({
      data: {
        type,
        message,
        metadata,
      },
    });
  } catch (error) {
    console.error("Failed to log bot activity:", error.message);
  }
}

module.exports = {
  logBotActivity,
};