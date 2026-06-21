require("dotenv").config();

const axios = require("axios");

const command = process.argv[2];
const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5050}`;
const controlKey = process.env.SYSTEM_CONTROL_API_KEY;

async function main() {
  if (!["pause", "resume", "status"].includes(command)) {
    console.error("Usage: node src/scripts/system-control.js <pause|resume|status>");
    process.exit(1);
  }

  const headers = {};

  if (controlKey) {
    headers["x-system-control-key"] = controlKey;
  }

  if (command === "status") {
    const res = await axios.get(`${backendUrl}/system/status`, {
      headers,
    });

    console.log(JSON.stringify(res.data, null, 2));
    return;
  }

  const res = await axios.post(
    `${backendUrl}/system/${command}`,
    {
      reason: command === "pause" ? "Manual pause" : undefined,
    },
    {
      headers,
    },
  );

  console.log(JSON.stringify(res.data, null, 2));
}

main().catch((error) => {
  console.error(error.response?.data || error.message);
  process.exit(1);
});
