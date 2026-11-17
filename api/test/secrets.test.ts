import { verifyWebhookSignature } from "@mohar/sdk";
import { describe, expect, it } from "vitest";
import type { TransactionRecord } from "../src/domain/types.js";
import { PartnerDirectory } from "../src/http/auth.js";
import { findWeakSecrets, LOCAL_ONLY } from "../src/secrets.js";
import { WebhookSender } from "../src/services/webhooks.js";

const KEY_A = "mk_live_aaaaaaaaaaaaaaaaaaaaaaaa";
const KEY_B = "mk_live_bbbbbbbbbbbbbbbbbbbbbbbb";
const SECRET_A = "whsec_aaaaaaaaaaaaaaaaaaaaaaaaaa";
const SECRET_B = "whsec_bbbbbbbbbbbbbbbbbbbbbbbbbb";
const DEV_KEY = "mk_dev_cccccccccccccccccccccccc";
const URLS = "bank-a=https://a.example/hooks,bank-b=https://b.example/hooks";

function check(
  directory: PartnerDirectory,
  dev: { devRoutes: boolean; devApiKey?: string; kycHashSecret?: string | undefined },
) {
  return findWeakSecrets({
    apiKeys: directory.apiKeys(),
    partners: directory.all(),
    kycHashSecret: "kyc_dddddddddddddddddddddddd",
    ...dev,
  });
}

describe("secrets off the local chain", () => {
  it("accepts strong, distinct secrets", () => {
    const directory = new PartnerDirectory(
      `${KEY_A}=bank-a,${KEY_B}=bank-b`,
      URLS,
      `bank-a=${SECRET_A},bank-b=${SECRET_B}`,
      LOCAL_ONLY.webhookSecret,
    );
    expect(check(directory, { devRoutes: true, devApiKey: DEV_KEY })).toEqual([]);
    expect(check(directory, { devRoutes: false })).toEqual([]);
  });

  it("refuses the repo's public defaults", () => {
    const directory = new PartnerDirectory(
      LOCAL_ONLY.partnerApiKeys,
      "demo-bank=http://localhost:3000/hooks",
      "",
      LOCAL_ONLY.webhookSecret,
    );
    const problems = check(directory, { devRoutes: true, devApiKey: LOCAL_ONLY.devApiKey });
    expect(problems).toHaveLength(4);
    expect(problems[0]).toMatch(/^PARTNER_API_KEYS: key 1 is the repo's local default/);
    expect(problems[1]).toMatch(/^PARTNER_API_KEYS: key 2 is the repo's local default/);
    expect(problems[2]).toMatch(/^PARTNER_WEBHOOK_SECRETS: no secret for "demo-bank"/);
    expect(problems[3]).toMatch(/^DEV_API_KEY: is the repo's local default/);
  });

  it("refuses short secrets and never prints a secret's value", () => {
    const directory = new PartnerDirectory("shortkey123=bank-a", URLS, "bank-a=tooshort", "x");
    const problems = check(directory, { devRoutes: false });
    expect(problems.join("\n")).toMatch(/key 1 is shorter than 24 characters/);
    expect(problems.join("\n")).toMatch(/the secret for "bank-a" is shorter than 24/);
    expect(problems.join("\n")).not.toContain("shortkey123");
    expect(problems.join("\n")).not.toContain("tooshort");
  });

  it("refuses one webhook secret shared by two partners", () => {
    const directory = new PartnerDirectory(
      `${KEY_A}=bank-a,${KEY_B}=bank-b`,
      URLS,
      `bank-a=${SECRET_A},bank-b=${SECRET_A}`,
    );
    expect(check(directory, { devRoutes: false })).toEqual([
      expect.stringMatching(/"bank-b" and "bank-a" share a secret/),
    ]);
  });

  it("requires an operator key of its own when dev routes are on", () => {
    const directory = new PartnerDirectory(`${KEY_A}=bank-a`, "", "");
    expect(check(directory, { devRoutes: true })).toEqual([
      "DEV_API_KEY: required when ENABLE_DEV_ROUTES=true",
    ]);
    expect(check(directory, { devRoutes: true, devApiKey: KEY_A })).toEqual([
      "DEV_API_KEY: must differ from every partner API key",
    ]);
  });
});

describe("KYC fingerprint secret", () => {
  const directory = new PartnerDirectory(`${KEY_A}=bank-a`, "", "");

  it("is required, and the repo's default is refused", () => {
    expect(check(directory, { devRoutes: false, kycHashSecret: undefined })).toEqual([
      expect.stringMatching(/^KYC_HASH_SECRET: required/),
    ]);
    expect(check(directory, { devRoutes: false, kycHashSecret: LOCAL_ONLY.kycHashSecret })).toEqual(
      [expect.stringMatching(/^KYC_HASH_SECRET: is the repo's local default/)],
    );
  });
});

describe("webhooks per partner", () => {
  const txn = { id: "txn_1", status: "confirmed" } as unknown as TransactionRecord;

  it("signs each partner's events with that partner's own secret", async () => {
    const sent: { url: string; body: string; signature: string }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      sent.push({
        url: String(url),
        body: String(init?.body),
        signature: headers["Mohar-Signature"]!,
      });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const directory = new PartnerDirectory(
      `${KEY_A}=bank-a,${KEY_B}=bank-b`,
      URLS,
      `bank-a=${SECRET_A},bank-b=${SECRET_B}`,
    );
    const sender = new WebhookSender((t) => ({ id: t.id, status: t.status }), fetchImpl);

    sender.send(directory.get("bank-a")!, "transaction.confirmed", txn);
    sender.send(directory.get("bank-b")!, "transaction.confirmed", txn);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const toA = sent.find((s) => s.url.startsWith("https://a.example"))!;
    const verify = (secret: string) =>
      verifyWebhookSignature({ payload: toA.body, header: toA.signature, secret });
    expect(verify(SECRET_A).type).toBe("transaction.confirmed");
    // Bank B knows only its own secret, so it cannot produce or pass off an event as MOHAR's to A.
    expect(() => verify(SECRET_B)).toThrow();
  });
});
