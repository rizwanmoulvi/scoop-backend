const DEFAULT_PREDICT_SERVER_URL =
  "https://predict-server.testnet.mystenlabs.com";

const DEFAULT_PREDICT_PACKAGE_ID =
  "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138";

const DEFAULT_PREDICT_OBJECT_ID =
  "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a";

const DEFAULT_PREDICT_REGISTRY_ID =
  "0x43af14fed5480c20ff77e2263d5f794c35b9fab7e2212903127062f4fe2a6e64";

const DEFAULT_DUSDC_COIN_TYPE =
  "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC";

const DEFAULT_PLP_COIN_TYPE =
  `${DEFAULT_PREDICT_PACKAGE_ID}::plp::PLP`;

function getDeepbookPredictConfig() {
  return {
    serverUrl: process.env.PREDICT_SERVER_URL || DEFAULT_PREDICT_SERVER_URL,
    packageId: process.env.PREDICT_PACKAGE_ID || DEFAULT_PREDICT_PACKAGE_ID,
    registryId: process.env.PREDICT_REGISTRY_ID || DEFAULT_PREDICT_REGISTRY_ID,
    objectId: process.env.PREDICT_OBJECT_ID || DEFAULT_PREDICT_OBJECT_ID,
    dusdcCoinType: process.env.DUSDC_COIN_TYPE || DEFAULT_DUSDC_COIN_TYPE,
    plpCoinType: process.env.PLP_COIN_TYPE || DEFAULT_PLP_COIN_TYPE,
  };
}

module.exports = {
  getDeepbookPredictConfig,
};
