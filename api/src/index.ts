import { createApp } from "./app.js";
import { bootstrap } from "./bootstrap.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

try {
  const ctx = await bootstrap(config);
  const app = createApp(ctx);
  app.listen(config.PORT, () => {
    const d = ctx.chain.deployment;
    console.log(`MOHAR API listening on http://localhost:${config.PORT}`);
    console.log(
      `  chain ${d.chainId} · token ${d.moharToken} · price feed ${d.mockFeed ? "mock" : "Chainlink"}`,
    );
    console.log(
      `  partners: ${ctx.partners
        .all()
        .map((p) => p.slug)
        .join(", ")}`,
    );
    if (ctx.settings.devRoutes) console.log("  dev routes enabled: POST /dev/price");
  });
} catch (error) {
  console.error(`\nMOHAR API could not start:\n  ${(error as Error).message}\n`);
  process.exit(1);
}
