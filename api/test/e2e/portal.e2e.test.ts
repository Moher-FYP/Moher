import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MoharClient } from "@mohar/sdk";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { bootstrap } from "../../src/bootstrap.js";
import { loadConfig } from "../../src/config.js";
import type { AppContext } from "../../src/context.js";
import { hashPassword } from "../../src/portal/passwords.js";
import type { PortalRole } from "../../src/portal/portal-store.js";
import { codeAt, counterAt, newTotpSecret } from "../../src/portal/totp.js";

/**
 * The partner portal in a real browser, against a real chain:
 *   Anvil ← contracts ← MOHAR API ← portal app (next start) ← Chromium (Playwright)
 * Needs Foundry, a built portal (pnpm --filter @mohar/portal build) and Playwright's Chromium
 * (pnpm --filter @mohar/api exec playwright install chromium); skipped when one is missing.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CHAIN_PORT = 18_645;
const RPC_URL = `http://127.0.0.1:${CHAIN_PORT}`;
const PORTAL_PORT = 13_002;
const ORIGIN = `http://127.0.0.1:${PORTAL_PORT}`;
const API_KEY = "mk_test_portal_e2e";
const PASSWORD = "portal end to end password";

const hasFoundry = spawnSync("anvil", ["--version"]).status === 0;
const portalBuilt = existsSync(join(ROOT, "portal", ".next", "BUILD_ID"));
const hasChromium = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

// Locally it is skipped when something is missing; in CI that would hide a broken setup.
if (process.env.CI === "true" && (!portalBuilt || !hasChromium)) {
  throw new Error("CI must build the portal and install Playwright's Chromium before this test");
}

describe.skipIf(!hasFoundry || !portalBuilt || !hasChromium)("partner portal in a browser", () => {
  let anvil: ChildProcess;
  let portal: ChildProcess;
  let api: Server;
  let ctx: AppContext;
  let browser: Browser;
  let walletId: string;
  const secrets: Record<string, string> = {};
  const usedStep: Record<string, number> = {};
  const consoleErrors: string[] = [];

  beforeAll(async () => {
    anvil = spawn("anvil", ["--port", String(CHAIN_PORT), "--silent"], { stdio: "ignore" });
    await waitFor(async () => (await rpc("eth_chainId")) === "0x7a69");
    const deploy = spawnSync(
      "forge",
      ["script", "script/Deploy.s.sol", "--rpc-url", RPC_URL, "--broadcast"],
      { cwd: join(ROOT, "contracts"), encoding: "utf8" },
    );
    if (deploy.status !== 0) throw new Error(`Deploy failed:\n${deploy.stdout}\n${deploy.stderr}`);

    ctx = await bootstrap(
      loadConfig({
        RPC_URL,
        DEPLOYMENT_FILE: join(ROOT, "contracts", "deployments", "31337.json"),
        DATA_DIR: ":memory:",
        PARTNER_API_KEYS: `${API_KEY}=demo-bank`,
        PARTNER_WEBHOOK_URLS: "",
        PORTAL_ORIGINS: ORIGIN,
      }),
    );
    api = createApp(ctx).listen(0, "127.0.0.1");
    await new Promise((resolve) => api.once("listening", resolve));
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

    // People, as an operator would add them (the CLI and the operator page do the same).
    const portalCtx = ctx.portal!;
    const passwordHash = await hashPassword(PASSWORD);
    const add = (email: string, role: PortalRole, partnerSlug?: string) => {
      secrets[email] = newTotpSecret();
      portalCtx.store.saveUser({
        id: `usr_${email.replace(/\W/g, "")}`,
        email,
        ...(partnerSlug ? { partnerSlug } : {}),
        role,
        passwordHash,
        totpSecretSealed: portalCtx.manage!.sealer.seal(secrets[email]!),
        status: "active",
        failedAttempts: 0,
        createdAt: new Date().toISOString(),
      });
    };
    add("comp@demo-bank.test", "compliance", "demo-bank");
    add("dev@demo-bank.test", "developer", "demo-bank");
    add("ops@mohar.test", "operator");

    // One customer with one purchase, so the pages have something to show.
    const mohar = new MoharClient({ apiKey: API_KEY, baseUrl: apiUrl });
    const wallet = await mohar.registerWallet({
      externalCustomerId: "HASSAN-E2E",
      kyc: { reference: "KYC-E2E-1", level: "standard", verifiedAt: new Date().toISOString() },
    });
    walletId = wallet.id;
    const quote = await mohar.createQuote({ walletId, side: "buy", amountPkr: "25000.00" });
    const pending = await mohar.mint(
      { quoteId: quote.id },
      { idempotencyKey: "portal-e2e-mint-1" },
    );
    await mohar.waitForTransaction(pending.id, { intervalMs: 200 });

    portal = spawn(
      join(ROOT, "portal", "node_modules", ".bin", "next"),
      ["start", "-p", String(PORTAL_PORT), "-H", "127.0.0.1"],
      {
        cwd: join(ROOT, "portal"),
        env: { ...process.env, MOHAR_API_URL: apiUrl, NODE_ENV: "production" },
        stdio: "ignore",
      },
    );
    await waitFor(async () => {
      try {
        return (await fetch(`${ORIGIN}/login`)).status === 200;
      } catch {
        return false;
      }
    }, 60_000);
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
    portal?.kill();
    ctx?.price.stopKeeper();
    await ctx?.settlement.idle();
    api?.close();
    anvil?.kill();
  });

  /** Signs in through the page, with the code an authenticator app would show now. */
  async function signIn(email: string): Promise<{ context: BrowserContext; page: Page }> {
    const step = () => counterAt(Math.floor(Date.now() / 1000));
    // A code works once: wait for a fresh step if this user signed in during this one.
    await waitFor(async () => usedStep[email] !== step(), 35_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("401")) consoleErrors.push(m.text());
    });
    page.on("dialog", (d) => void d.accept());
    await page.goto(`${ORIGIN}/login`);
    await page.fill("input[name=email]", email);
    await page.fill("input[name=password]", PASSWORD);
    await page.fill("input[name=code]", codeAt(secrets[email]!, step()));
    usedStep[email] = step();
    await page.click("button[type=submit]");
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
    return { context, page };
  }

  it("serves pages with a nonce-based Content-Security-Policy", async () => {
    const res = await fetch(`${ORIGIN}/login`);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("refuses a wrong code and shows why", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/login`);
    await page.fill("input[name=email]", "dev@demo-bank.test");
    await page.fill("input[name=password]", PASSWORD);
    await page.fill("input[name=code]", "000000");
    await page.click("button[type=submit]");
    await page.getByText("Email, password or code is wrong").waitFor();
    await context.close();
  });

  it("shows compliance the partner's customers and lets them ask for a freeze", async () => {
    const { context, page } = await signIn("comp@demo-bank.test");
    await page.getByText("Latest transactions").waitFor();
    await page.click("text=Customers");
    await page.click("text=HASSAN-E2E");
    await page.getByText("KYC limits used").waitFor();
    await page.fill("textarea[name=reason]", "End-to-end test: AML alert 2026-E2E");
    await page.click("text=Ask MOHAR to freeze");
    await page.getByText("A MOHAR operator will review it").waitFor();
    await context.close();
  });

  it("lets an operator carry out the freeze on-chain from the compliance key", async () => {
    const { context, page } = await signIn("ops@mohar.test");
    await page.getByText("Freeze requests").first().waitFor();
    await page.click("button:has-text('Freeze')");
    await page.locator("td >> text=done").waitFor({ timeout: 30_000 });
    const wallet = ctx.store.getWallet(walletId)!;
    expect(await ctx.chain.isWalletActive(wallet.address)).toBe(false);
    await context.close();
  });

  it("anchors the audit log on-chain, and compliance sees it match", async () => {
    const ops = await signIn("ops@mohar.test");
    await ops.page.click("button:has-text('Anchor audit log on-chain')");
    await ops.page.getByText(/Anchored in 0x/).waitFor();
    await ops.context.close();

    const comp = await signIn("comp@demo-bank.test");
    await comp.page.click("text=Compliance");
    await comp.page.getByText(/Matches 1 on-chain anchor/).waitFor();
    await comp.context.close();
  });

  it("lets an operator add a person and shows the QR code once", async () => {
    const { context, page } = await signIn("ops@mohar.test");
    await page.getByText("People").first().waitFor();
    await page.locator("select[name=partner] option").first().waitFor({ state: "attached" });
    await page.fill("form input[name=email]", "analyst@demo-bank.test");
    await page.click("button:has-text('Add person')");
    await page.getByText("Sign-in details for analyst@demo-bank.test").waitFor();
    await expect(
      page.locator("img[alt='QR code for the authenticator app']").count(),
    ).resolves.toBe(1);
    if (process.env.PORTAL_SCREENSHOTS) {
      const path = join(process.env.PORTAL_SCREENSHOTS, "operator.png");
      await page.screenshot({ path, fullPage: true });
    }
    await page.click("text=Done, hide these");
    await expect(page.getByText("Sign-in details for").count()).resolves.toBe(0);
    await context.close();
  });

  it("lets a developer make an API key that works, then revoke it", async () => {
    const { context, page } = await signIn("dev@demo-bank.test");
    await page.click("text=API keys and webhooks");
    await page.fill("input[name=name]", "E2E key");
    await page.click("button:has-text('Create key')");
    const key = (
      await page
        .locator(".mono", { hasText: /^mk_test_[\w-]{43}$/ })
        .first()
        .innerText()
    ).trim();
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const call = () => fetch(`${apiUrl}/v1/price`, { headers: { Authorization: `Bearer ${key}` } });
    expect((await call()).status).toBe(200);
    await page.click("text=I have saved it");
    await page.click("button:has-text('Revoke')");
    await waitFor(async () => (await call()).status === 401, 5_000);
    await context.close();
  });

  it("logged no browser errors (a CSP violation would show here)", () => {
    expect(consoleErrors).toEqual([]);
  });
});

async function rpc(method: string): Promise<unknown> {
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
    });
    return ((await res.json()) as { result: unknown }).result;
  } catch {
    return undefined;
  }
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for condition");
}
