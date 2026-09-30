import { createPublicClient, http } from "viem";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const publicClient = createPublicClient({ transport: http(config.RPC_URL) });

const app = createApp({
  chain: {
    getChainId: () => publicClient.getChainId(),
    getBlockNumber: () => publicClient.getBlockNumber(),
  },
});

app.listen(config.PORT, () => {
  console.log(`MOHAR API listening on http://localhost:${config.PORT} (RPC ${config.RPC_URL})`);
});
