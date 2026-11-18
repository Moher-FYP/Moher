import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { verifyWebhookSignature } from "@mohar/sdk";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { ComplianceSigner } from "../src/chain/compliance.js";
import type { TransactionRecord } from "../src/domain/types.js";
import {
  checkWebhookUrl,
  isAllowedAddress,
  safeTransport,
  UnsafeUrlError,
} from "../src/lib/safe-post.js";
import { ORIGIN, setup } from "./portal-fixture.js";

// ---------------------------------------------------------------- SSRF guard

describe("webhook addresses (SSRF)", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:a9fe:a9fe",
    "64:ff9b::10.0.0.1",
  ])("refuses %s", (address) => {
    expect(isAllowedAddress(address, false)).toBe(false);
  });

  it.each(["8.8.8.8", "104.16.0.1", "2606:4700::1111"])("allows public %s", (address) => {
    expect(isAllowedAddress(address, false)).toBe(true);
  });

  it("allows loopback only when told to, and nothing else private", () => {
    expect(isAllowedAddress("127.0.0.1", true)).toBe(true);
    expect(isAllowedAddress("::1", true)).toBe(true);
    expect(isAllowedAddress("10.0.0.1", true)).toBe(false);
    expect(isAllowedAddress("169.254.169.254", true)).toBe(false);
  });

  it.each([
    ["http://bank.example/hooks", /https/],
    ["https://user:pw@bank.example/hooks", /credentials/],
    ["https://169.254.169.254/latest/meta-data", /public address/],
    ["https://0x7f000001/hooks", /public address/],
    ["https://2130706433/hooks", /public address/],
    ["https://[::ffff:10.0.0.1]/hooks", /public address/],
    ["https://localhost/hooks", /public address/],
    ["not a url", /valid URL/],
  ])("refuses %s", (url, message) => {
    expect(() => checkWebhookUrl(url, false)).toThrow(message);
  });

  it("allows https to a name, and http://localhost only for the local demo", () => {
    expect(checkWebhookUrl("https://bank.example/hooks", false).hostname).toBe("bank.example");
    expect(() => checkWebhookUrl("http://localhost:3000/hooks", false)).toThrow(UnsafeUrlError);
    expect(checkWebhookUrl("http://localhost:3000/hooks", true).port).toBe("3000");
    expect(() => checkWebhookUrl("http://10.0.0.5/hooks", true)).toThrow(/https/);
  });

  it("checks the address a name resolves to when it connects (no DNS rebinding gap)", async () => {
    const post = safeTransport({
      allowLoopback: false,
      // A public-looking name that resolves to cloud metadata.
      resolve: ((_host: string, _opts: unknown, cb: Function) =>
        cb(null, [{ address: "169.254.169.254", family: 4 }])) as never,
    });
    await expect(post("https://evil.example/hooks", {}, "{}")).rejects.toThrow(
      /resolves to an address MOHAR will not call/,
    );
  });

  it("posts to an allowed address and does not follow redirects", async () => {
    let hits = 0;
    const server = createServer((req, res) => {
      hits += 1;
      res.writeHead(302, { Location: "http://169.254.169.254/" }).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const post = safeTransport({ allowLoopback: true });
      const result = await post(`http://localhost:${port}/hooks`, {}, "{}");
      expect(result.status).toBe(302);
      expect(hits).toBe(1);
    } finally {
      server.close();
    }
  });
});

// ---------------------------------------------------------------- API keys

describe("API keys from the portal", () => {
  it("are shown once, work on /v1, and stop working when revoked", async () => {
    const { app, signIn, portalStore } = await setup();
    const cookie = await signIn("dev@bank.test");
    const created = await request(app)
      .post("/portal/v1/api-keys")
      .set("Cookie", cookie)
      .set("Origin", ORIGIN)
      .send({ name: "Production server" });
    expect(created.status).toBe(201);
    const key: string = created.body.key;
    expect(key).toMatch(/^mk_test_[\w-]{43}$/);
    expect(JSON.stringify(portalStore)).not.toContain(key);

    const list = await request(app).get("/portal/v1/api-keys").set("Cookie", cookie);
    expect(list.body.data[0]).toMatchObject({ name: "Production server", status: "active" });
    expect(JSON.stringify(list.body)).not.toContain(key);
    expect(list.body.configured).toEqual([{ prefix: "mk_test_unit" }]);

    const ok = await request(app).get("/v1/transactions").set("Authorization", `Bearer ${key}`);
    expect(ok.status).toBe(200);

    const revoke = await request(app)
      .post(`/portal/v1/api-keys/${created.body.apiKey.id}/revoke`)
      .set("Cookie", cookie)
      .set("Origin", ORIGIN);
    expect(revoke.status).toBe(204);
    const refused = await request(app)
      .get("/v1/transactions")
      .set("Authorization", `Bearer ${key}`);
    expect(refused.status).toBe(401);
  });

  it("belong to one partner: another partner's users cannot see or revoke them", async () => {
    const { app, signIn } = await setup();
    const dev = await signIn("dev@bank.test");
    const created = await request(app)
      .post("/portal/v1/api-keys")
      .set("Cookie", dev)
      .set("Origin", ORIGIN)
      .send({ name: "Bank server" });

    const viewer = await signIn("viewer@bank.test");
    const asViewer = await request(app)
      .post("/portal/v1/api-keys")
      .set("Cookie", viewer)
      .set("Origin", ORIGIN)
      .send({ name: "x" });
    expect(asViewer.status).toBe(403);

    // A key made for demo-bank opens demo-bank's data only.
    const page = await request(app)
      .get("/v1/transactions")
      .set("Authorization", `Bearer ${created.body.key}`);
    expect(page.body.data.map((t: TransactionRecord) => t.id)).toEqual(["txn_bank1"]);
  });
});

// ---------------------------------------------------------------- webhooks

describe("webhook settings", () => {
  it("refuses an internal URL and saves a public one", async () => {
    const { app, signIn, partners } = await setup();
    const cookie = await signIn("dev@bank.test");
    const put = (url: string) =>
      request(app)
        .put("/portal/v1/webhook")
        .set("Cookie", cookie)
        .set("Origin", ORIGIN)
        .send({ url });
    expect((await put("https://10.0.0.7/hooks")).status).toBe(400);
    expect((await put("http://bank.example/hooks")).status).toBe(400);
    const ok = await put("https://hooks.bank.example/mohar");
    expect(ok.status).toBe(200);
    expect(partners.get("demo-bank")!.webhookUrl).toBe("https://hooks.bank.example/mohar");
    expect(partners.get("moher-wallet")!.webhookUrl).toBe("https://wallet.example/hooks");
  });

  it("rotates the secret, shows it once, and signs with it from then on", async () => {
    const { app, signIn, store, sent, webhooks, partners } = await setup();
    const cookie = await signIn("dev@bank.test");
    const rotated = await request(app)
      .post("/portal/v1/webhook/rotate-secret")
      .set("Cookie", cookie)
      .set("Origin", ORIGIN);
    expect(rotated.status).toBe(200);
    const secret: string = rotated.body.secret;
    expect(secret).toMatch(/^whsec_/);

    const settings = await request(app).get("/portal/v1/webhook").set("Cookie", cookie);
    expect(settings.body).toMatchObject({ secretSet: true });
    expect(JSON.stringify(settings.body)).not.toContain(secret);

    webhooks.send(
      partners.get("demo-bank")!,
      "transaction.confirmed",
      store.getTransaction("txn_bank1")!,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const last = sent.at(-1)!;
    const verify = (s: string) =>
      verifyWebhookSignature({
        payload: last.body,
        header: last.headers["Mohar-Signature"]!,
        secret: s,
      });
    expect(verify(secret).type).toBe("transaction.confirmed");
    expect(() => verify("whsec_bank_unit_test_secret")).toThrow();
  });

  it("logs every delivery and resends one with the same event id", async () => {
    const { app, signIn, store, sent, webhooks, partners } = await setup({ webhookStatus: 500 });
    webhooks.send(
      partners.get("demo-bank")!,
      "transaction.confirmed",
      store.getTransaction("txn_bank1")!,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    const cookie = await signIn("dev@bank.test");
    const log = await request(app).get("/portal/v1/webhook/deliveries").set("Cookie", cookie);
    expect(log.body.data).toHaveLength(1);
    const first = log.body.data[0];
    expect(first).toMatchObject({ status: "failed", transactionId: "txn_bank1" });
    expect(first.attempts[0].statusCode).toBe(500);

    const resent = await request(app)
      .post(`/portal/v1/webhook/deliveries/${first.id}/resend`)
      .set("Cookie", cookie)
      .set("Origin", ORIGIN);
    expect(resent.status).toBe(202);
    expect(resent.body).toMatchObject({ resendOf: first.id, eventId: first.eventId });
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body).toBe(sent[0]!.body);

    // The other partner sees none of it.
    const other = await signIn("comp@wallet.test");
    const theirs = await request(app).get("/portal/v1/webhook/deliveries").set("Cookie", other);
    expect(theirs.status).toBe(403); // compliance, not developer
  });
});

// ---------------------------------------------------------------- freezes

function fakeCompliance(fail = false) {
  const calls: string[] = [];
  const signer = {
    address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    freeze: async (wallet: string) => {
      calls.push(`freeze ${wallet}`);
      if (fail) throw new Error("AccessControlUnauthorizedAccount\nmore detail");
      return "0xabc";
    },
    unfreeze: async (wallet: string) => {
      calls.push(`unfreeze ${wallet}`);
      return "0xdef";
    },
  } as unknown as ComplianceSigner;
  return { signer, calls };
}

describe("freezes", () => {
  const reason = "Suspicious pattern reported by our AML team, case 2026-118";

  it("are requested by the partner's compliance and carried out by a MOHAR operator", async () => {
    const { signer, calls } = fakeCompliance();
    const { app, signIn, portalStore } = await setup({ compliance: signer });
    const comp = await signIn("comp@bank.test");
    const ask = (cookie: string, walletId = "wal_bank1") =>
      request(app)
        .post(`/portal/v1/wallets/${walletId}/freeze-requests`)
        .set("Cookie", cookie)
        .set("Origin", ORIGIN)
        .send({ reason });

    const created = await ask(comp);
    expect(created.status).toBe(201);
    expect((await ask(comp)).status).toBe(409); // one open request per wallet
    expect((await ask(comp, "wal_other1")).status).toBe(404); // another partner's wallet
    expect((await ask(await signIn("viewer@bank.test"))).status).toBe(403);

    // The partner cannot carry out its own request: that needs MOHAR.
    const self = await request(app)
      .post(`/portal/v1/admin/freeze-requests/${created.body.id}/approve`)
      .set("Cookie", comp)
      .set("Origin", ORIGIN);
    expect(self.status).toBe(403);

    const ops = await signIn("ops@mohar.test");
    const approved = await request(app)
      .post(`/portal/v1/admin/freeze-requests/${created.body.id}/approve`)
      .set("Cookie", ops)
      .set("Origin", ORIGIN);
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: "done", txHash: "0xabc" });
    expect(calls).toHaveLength(1);

    const again = await request(app)
      .post(`/portal/v1/admin/freeze-requests/${created.body.id}/approve`)
      .set("Cookie", ops)
      .set("Origin", ORIGIN);
    expect(again.status).toBe(409);
    expect(calls).toHaveLength(1);

    // The partner's compliance sees MOHAR's decision in its own audit log.
    const audit = await request(app).get("/portal/v1/audit").set("Cookie", comp);
    expect(audit.body.data.map((e: { action: string }) => e.action)).toContain("wallet.freeze");
    expect(portalStore.verifyLog("audit").intact).toBe(true);
  });

  it("are recorded but not carried out when no compliance key is set", async () => {
    const { app, signIn } = await setup();
    const comp = await signIn("comp@bank.test");
    const created = await request(app)
      .post("/portal/v1/wallets/wal_bank1/freeze-requests")
      .set("Cookie", comp)
      .set("Origin", ORIGIN)
      .send({ reason });
    const ops = await signIn("ops@mohar.test");
    const approve = await request(app)
      .post(`/portal/v1/admin/freeze-requests/${created.body.id}/approve`)
      .set("Cookie", ops)
      .set("Origin", ORIGIN);
    expect(approve.status).toBe(501);
    expect(approve.body.error.code).toBe("not_implemented");

    const reject = await request(app)
      .post(`/portal/v1/admin/freeze-requests/${created.body.id}/reject`)
      .set("Cookie", ops)
      .set("Origin", ORIGIN)
      .send({ note: "Not enough evidence" });
    expect(reject.body.status).toBe("rejected");
  });

  it("record a failure the chain reports", async () => {
    const { signer } = fakeCompliance(true);
    const { app, signIn } = await setup({ compliance: signer });
    const comp = await signIn("comp@bank.test");
    const created = await request(app)
      .post("/portal/v1/wallets/wal_bank1/freeze-requests")
      .set("Cookie", comp)
      .set("Origin", ORIGIN)
      .send({ reason });
    const ops = await signIn("ops@mohar.test");
    const approve = await request(app)
      .post(`/portal/v1/admin/freeze-requests/${created.body.id}/approve`)
      .set("Cookie", ops)
      .set("Origin", ORIGIN);
    expect(approve.status).toBe(502);
    const list = await request(app).get("/portal/v1/freeze-requests").set("Cookie", comp);
    expect(list.body.data[0]).toMatchObject({
      status: "failed",
      failure: "AccessControlUnauthorizedAccount",
    });
  });
});

describe("operator view", () => {
  it("lists every partner, for operators only", async () => {
    const { app, signIn } = await setup();
    const dev = await signIn("dev@bank.test");
    expect((await request(app).get("/portal/v1/admin/partners").set("Cookie", dev)).status).toBe(
      403,
    );
    const ops = await signIn("ops@mohar.test");
    const res = await request(app).get("/portal/v1/admin/partners").set("Cookie", ops);
    expect(res.body.data.map((p: { slug: string }) => p.slug)).toEqual([
      "demo-bank",
      "moher-wallet",
    ]);
    expect(res.body.data[0]).toMatchObject({ activeOnChain: true, customers: 1 });
  });
});

describe("operators manage people", () => {
  it("add a user with a new password and authenticator key, shown once", async () => {
    const { app, signIn, portalStore } = await setup();
    const ops = await signIn("ops@mohar.test");
    const created = await request(app)
      .post("/portal/v1/admin/users")
      .set("Cookie", ops)
      .set("Origin", ORIGIN)
      .send({ email: "New.Analyst@Bank.test", role: "viewer", partner: "demo-bank" });
    expect(created.status).toBe(201);
    expect(created.body.user).toMatchObject({
      email: "new.analyst@bank.test",
      role: "viewer",
      status: "active",
    });
    expect(created.body.password).toHaveLength(24);
    expect(created.body.otpauthUri).toContain(`secret=${created.body.setupKey}`);
    // Neither secret is stored as given.
    expect(JSON.stringify(portalStore)).not.toContain(created.body.password);
    expect(JSON.stringify(portalStore)).not.toContain(created.body.setupKey);

    const list = await request(app).get("/portal/v1/admin/users").set("Cookie", ops);
    expect(JSON.stringify(list.body)).not.toContain("passwordHash");
    expect(list.body.data.map((u: { email: string }) => u.email)).toContain(
      "new.analyst@bank.test",
    );

    const again = await request(app)
      .post("/portal/v1/admin/users")
      .set("Cookie", ops)
      .set("Origin", ORIGIN)
      .send({ email: "new.analyst@bank.test", role: "viewer", partner: "demo-bank" });
    expect(again.status).toBe(409);
    const operatorWithPartner = await request(app)
      .post("/portal/v1/admin/users")
      .set("Cookie", ops)
      .set("Origin", ORIGIN)
      .send({ email: "x@mohar.test", role: "operator", partner: "demo-bank" });
    expect(operatorWithPartner.status).toBe(400);
  });

  it("unlock a locked account, and reset one, which signs it out", async () => {
    const { app, signIn, portalStore } = await setup();
    const viewer = await signIn("viewer@bank.test");
    const user = portalStore.findUserByEmail("viewer@bank.test")!;
    portalStore.updateUser(user.id, { status: "disabled", failedAttempts: 20 });

    const ops = await signIn("ops@mohar.test");
    const list = await request(app).get("/portal/v1/admin/users").set("Cookie", ops);
    expect(list.body.data.find((u: { id: string }) => u.id === user.id)).toMatchObject({
      status: "disabled",
      failedAttempts: 20,
    });

    const enable = await request(app)
      .post(`/portal/v1/admin/users/${user.id}/enable`)
      .set("Cookie", ops)
      .set("Origin", ORIGIN);
    expect(enable.body).toMatchObject({ status: "active", failedAttempts: 0 });

    const reset = await request(app)
      .post(`/portal/v1/admin/users/${user.id}/reset`)
      .set("Cookie", ops)
      .set("Origin", ORIGIN);
    expect(reset.status).toBe(200);
    expect(reset.body.setupKey).toMatch(/^[A-Z2-7]{32}$/);
    expect((await request(app).get("/portal/v1/me").set("Cookie", viewer)).status).toBe(401);
  });

  it("are the only ones who can, and cannot lock themselves out", async () => {
    const { app, signIn, portalStore } = await setup();
    const comp = await signIn("comp@bank.test");
    const denied = await request(app)
      .post("/portal/v1/admin/users")
      .set("Cookie", comp)
      .set("Origin", ORIGIN)
      .send({ email: "a@bank.test", role: "viewer", partner: "demo-bank" });
    expect(denied.status).toBe(403);

    const ops = await signIn("ops@mohar.test");
    const self = portalStore.findUserByEmail("ops@mohar.test")!;
    const own = await request(app)
      .post(`/portal/v1/admin/users/${self.id}/disable`)
      .set("Cookie", ops)
      .set("Origin", ORIGIN);
    expect(own.status).toBe(409);
  });
});

describe("client address behind the portal", () => {
  it("logs the address the local proxy reports", async () => {
    const { app, codeFor, portalStore } = await setup();
    await request(app)
      .post("/portal/v1/session")
      .set("Origin", ORIGIN)
      .set("X-Forwarded-For", "203.0.113.9")
      .send({
        email: "dev@bank.test",
        password: "correct horse battery staple",
        code: codeFor("dev@bank.test"),
      });
    expect(portalStore.rawLog("security").at(-1)!.ip).toBe("203.0.113.9");
  });
});
