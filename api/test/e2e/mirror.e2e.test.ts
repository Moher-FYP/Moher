import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil as anvilChain } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "../../src/bootstrap.js";
import { loadConfig } from "../../src/config.js";
import type { AppContext } from "../../src/context.js";

/**
 * The price mirror against real contracts. A second MockV3Aggregator on the same Anvil chain
 * plays the part of Chainlink's XAU/USD feed on Polygon mainnet; the API must make the feed
 * MoharToken reads follow it. Requires Foundry on PATH; skipped otherwise.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PORT = 18_546;
const RPC_URL = `http://127.0.0.1:${PORT}`;
/** Anvil account #0: public development key, the deployer of everything in this test. */
const ANVIL_KEY_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const E8 = 10n ** 8n;

const feedAbi = parseAbi([
  "constructor(uint8 decimals_, string description_, int256 initialAnswer)",
  "function updateAnswer(int256 answer)",
]);

const hasFoundry = spawnSync("anvil", ["--version"]).status === 0;

describe.skipIf(!hasFoundry)("price mirror end to end (Anvil + API)", () => {
  let anvil: ChildProcess;
  let ctx: AppContext;
  let reference: Address;

  const account = privateKeyToAccount(ANVIL_KEY_0);
  const transport = http(RPC_URL);
  const publicClient = createPublicClient({ chain: anvilChain, transport });
  const walletClient = createWalletClient({ chain: anvilChain, transport, account });

  const onChainPrice = async () => (await ctx.price.current()).xauUsdE8;
  const moveReference = async (answer: bigint) => {
    const hash = await walletClient.writeContract({
      address: reference,
      abi: feedAbi,
      functionName: "updateAnswer",
      args: [answer],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  };

  beforeAll(async () => {
    anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
    await waitFor(async () => (await chainId()) === 31337);

    const deploy = spawnSync(
      "forge",
      ["script", "script/Deploy.s.sol", "--rpc-url", RPC_URL, "--broadcast"],
      { cwd: join(ROOT, "contracts"), encoding: "utf8" },
    );
    if (deploy.status !== 0) throw new Error(`Deploy failed:\n${deploy.stdout}\n${deploy.stderr}`);

    // The stand-in for Chainlink on Polygon mainnet, at $4,700 while MOHAR deployed at $4,616.
    const artifact = JSON.parse(
      readFileSync(
        join(ROOT, "contracts", "out", "MockV3Aggregator.sol", "MockV3Aggregator.json"),
        "utf8",
      ),
    ) as { bytecode: { object: Hex } };
    const hash = await walletClient.deployContract({
      abi: feedAbi,
      bytecode: artifact.bytecode.object,
      args: [8, "XAU / USD", 4_700n * E8],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error("Reference feed was not deployed");
    reference = receipt.contractAddress;

    ctx = await bootstrap(
      loadConfig({
        RPC_URL,
        DEPLOYMENT_FILE: join(ROOT, "contracts", "deployments", "31337.json"),
        DATA_DIR: ":memory:",
        MIRROR_RPC_URL: RPC_URL,
        MIRROR_FEED_ADDRESS: reference,
      }),
    );
  });

  afterAll(async () => {
    ctx?.price.stopKeeper();
    await ctx?.settlement.idle();
    anvil?.kill();
  });

  it("starts from the reference price, not the deploy-time one", async () => {
    expect(await onChainPrice()).toBe(4_700n * E8);
  });

  it("ignores a move smaller than 0.20%", async () => {
    await moveReference(4_704n * E8);
    await ctx.price.tick();
    expect(await onChainPrice()).toBe(4_700n * E8);
  });

  it("follows the reference once it has moved enough", async () => {
    await moveReference(4_747n * E8);
    await ctx.price.tick();
    expect(await onChainPrice()).toBe(4_747n * E8);
  });

  it("never copies a broken reference", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await moveReference(0n);
    await ctx.price.tick();
    expect(await onChainPrice()).toBe(4_747n * E8);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    await moveReference(4_747n * E8);
  });

  it("holds a manual demo price instead of snapping back", async () => {
    await ctx.price.setMockPrice(4_800n * E8);
    await ctx.price.tick();
    expect(await onChainPrice()).toBe(4_800n * E8);
  });

  it("reset goes straight back to the reference price", async () => {
    await ctx.price.resetMockPrice();
    expect(await onChainPrice()).toBe(4_747n * E8);
  });

  it("refuses a mirror address that is not a gold feed", async () => {
    const config = loadConfig({
      RPC_URL,
      DEPLOYMENT_FILE: join(ROOT, "contracts", "deployments", "31337.json"),
      DATA_DIR: ":memory:",
      MIRROR_RPC_URL: RPC_URL,
      MIRROR_FEED_ADDRESS: ctx.chain.deployment.moharToken, // a contract, but not a feed
    });
    await expect(bootstrap(config)).rejects.toThrow(/Cannot use the mirror feed/);
  });

  async function chainId(): Promise<number | undefined> {
    return publicClient.getChainId().catch(() => undefined);
  }
});

async function waitFor(check: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for condition");
}
