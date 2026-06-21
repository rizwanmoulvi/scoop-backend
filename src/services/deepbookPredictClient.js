const axios = require("axios");
const { getDeepbookPredictConfig } = require("../config/deepbookPredict");

function createDeepbookPredictClient(config = getDeepbookPredictConfig()) {
  const client = axios.create({
    baseURL: config.serverUrl,
    timeout: Number(process.env.PREDICT_SERVER_TIMEOUT_MS || 10000),
  });

  async function get(path, params) {
    const res = await client.get(path, { params });
    return res.data;
  }

  return {
    config,

    async getStatus() {
      return get("/status");
    },

    async getPredictState(predictId = config.objectId) {
      return get(`/predicts/${predictId}/state`);
    },

    async getPredictOracles(predictId = config.objectId) {
      const data = await get(`/predicts/${predictId}/oracles`);
      return normalizeList(data, "oracles");
    },

    async getQuoteAssets(predictId = config.objectId) {
      const data = await get(`/predicts/${predictId}/quote-assets`);
      return normalizeList(data, "quoteAssets");
    },

    async getOracleState(oracleId) {
      return get(`/oracles/${oracleId}/state`);
    },

    async getLatestOraclePrice(oracleId) {
      return get(`/oracles/${oracleId}/prices/latest`);
    },

    async getLatestOracleSvi(oracleId) {
      return get(`/oracles/${oracleId}/svi/latest`);
    },

    async getOracleAskBounds(oracleId) {
      return get(`/oracles/${oracleId}/ask-bounds`);
    },
  };
}

function normalizeList(data, preferredKey) {
  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.[preferredKey])) {
    return data[preferredKey];
  }

  if (Array.isArray(data?.data)) {
    return data.data;
  }

  if (Array.isArray(data?.items)) {
    return data.items;
  }

  return [];
}

function readField(object, names) {
  for (const name of names) {
    if (object?.[name] !== undefined && object?.[name] !== null) {
      return object[name];
    }
  }

  return undefined;
}

function readNumber(object, names) {
  const value = readField(object, names);

  if (value === undefined || value === null || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readObjectId(object) {
  return readField(object, [
    "id",
    "objectId",
    "object_id",
    "oracleId",
    "oracle_id",
  ]);
}

function readExpiryMs(object) {
  const expiry = readField(object, ["expiry", "expiryMs", "expiry_ms"]);

  if (expiry === undefined || expiry === null) {
    return null;
  }

  const numeric = Number(expiry);

  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const parsed = Date.parse(expiry);
  return Number.isFinite(parsed) ? parsed : null;
}

function readUnderlyingAsset(object) {
  return String(
    readField(object, [
      "underlyingAsset",
      "underlying_asset",
      "asset",
      "symbol",
      "underlying",
    ]) || "",
  ).toUpperCase();
}

function readOracleStatus(object) {
  const status = readField(object, ["status", "lifecycleStatus", "lifecycle_status"]);

  if (typeof status === "number") {
    return ["INACTIVE", "ACTIVE", "PENDING_SETTLEMENT", "SETTLED"][status] || String(status);
  }

  if (typeof status === "string") {
    return status.toUpperCase();
  }

  if (object?.active === true) {
    return "ACTIVE";
  }

  if (object?.settlementPrice || object?.settlement_price) {
    return "SETTLED";
  }

  return "UNKNOWN";
}

function normalizeScaledPrice(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  // DeepBook Predict Move prices are scaled by 1e9. Server payloads may already
  // be decimalized, so only scale down obviously raw values.
  return numeric > 1_000_000 ? numeric / 1_000_000_000 : numeric;
}

module.exports = {
  createDeepbookPredictClient,
  normalizeList,
  normalizeScaledPrice,
  readExpiryMs,
  readField,
  readNumber,
  readObjectId,
  readOracleStatus,
  readUnderlyingAsset,
};
