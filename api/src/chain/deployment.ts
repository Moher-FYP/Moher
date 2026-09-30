import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAddress, type Address, type Hex } from "viem";
import { z } from "zod";

const address = z.string().transform((value, ctx) => {
  try {
    return getAddress(value);
  } catch {
    ctx.addIssue({ code: "custom", message: `not an address: ${value}` });
    return z.NEVER;
  }
});

const DeploymentSchema = z.object({
  chainId: z.number().int().positive(),
  admin: address,
  relayer: address,
  vaultSigner: address,
  walletRegistry: address,
  moharToken: address,
  reserveRegistry: address,
  xauUsdFeed: address,
  mockFeed: z.boolean(),
  maxStaleness: z.number().int().positive(),
  demoPartnerId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

export interface Deployment {
  chainId: number;
  admin: Address;
  relayer: Address;
  vaultSigner: Address;
  walletRegistry: Address;
  moharToken: Address;
  reserveRegistry: Address;
  xauUsdFeed: Address;
  mockFeed: boolean;
  maxStaleness: number;
  demoPartnerId: Hex;
}

/** Reads contracts/deployments/<chainId>.json written by contracts/script/Deploy.s.sol. */
export function loadDeployment(path: string): Deployment {
  const fullPath = resolve(path);
  let raw: string;
  try {
    raw = readFileSync(fullPath, "utf8");
  } catch {
    throw new Error(
      `No deployment file at ${fullPath}. Deploy the contracts first: pnpm contracts:deploy:local`,
    );
  }
  const parsed = DeploymentSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`Invalid deployment file ${fullPath}: ${parsed.error.message}`);
  }
  return parsed.data as Deployment;
}
