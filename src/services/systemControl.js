let paused = process.env.SYSTEM_PAUSED === "true";
let updatedAt = new Date();
let updatedBy = "env";
let reason = paused ? "Paused by SYSTEM_PAUSED env" : "";

function isSystemPaused() {
  return paused;
}

function getSystemStatus() {
  return {
    paused,
    updatedAt,
    updatedBy,
    reason,
  };
}

function pauseSystem({ by = "api", pauseReason = "" } = {}) {
  paused = true;
  updatedAt = new Date();
  updatedBy = by;
  reason = pauseReason;

  return getSystemStatus();
}

function resumeSystem({ by = "api" } = {}) {
  paused = false;
  updatedAt = new Date();
  updatedBy = by;
  reason = "";

  return getSystemStatus();
}

async function restoreSystemControlFromDatabase(prisma) {
  const latestControlEvent = await prisma.botActivity.findFirst({
    where: {
      type: {
        in: ["SYSTEM_PAUSED", "SYSTEM_RESUMED"],
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!latestControlEvent) {
    return getSystemStatus();
  }

  paused = latestControlEvent.type === "SYSTEM_PAUSED";
  updatedAt = latestControlEvent.createdAt;
  updatedBy = latestControlEvent.metadata?.updatedBy || "database";
  reason = latestControlEvent.metadata?.reason || "";

  return getSystemStatus();
}

function requireSystemControl(req, res) {
  const expectedKey = process.env.SYSTEM_CONTROL_API_KEY;

  if (!expectedKey && process.env.NODE_ENV === "production") {
    res.status(503).json({
      success: false,
      error: "SYSTEM_CONTROL_API_KEY is required in production",
    });
    return false;
  }

  if (!expectedKey) {
    return true;
  }

  const providedKey = req.headers["x-system-control-key"];

  if (providedKey !== expectedKey) {
    res.status(401).json({
      success: false,
      error: "Invalid system control key",
    });
    return false;
  }

  return true;
}

module.exports = {
  getSystemStatus,
  isSystemPaused,
  pauseSystem,
  requireSystemControl,
  restoreSystemControlFromDatabase,
  resumeSystem,
};
