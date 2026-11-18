import request from "supertest";
import { describe, expect, it } from "vitest";
import { passwordProblem } from "../src/portal/passwords.js";
import { PortalStore } from "../src/portal/portal-store.js";
import { csvField } from "../src/portal/routes.js";
import { Sealer } from "../src/portal/sealed.js";
import {
  base32Decode,
  base32Encode,
  codeAt,
  counterAt,
  newTotpSecret,
  verifyCode,
} from "../src/portal/totp.js";
import { ORIGIN, PASSWORD, setup } from "./portal-fixture.js";

// ---------------------------------------------------------------- units

describe("one-time codes (RFC 6238)", () => {
  // The RFC's SHA-1 test secret is the ASCII "12345678901234567890"; its vectors are 8 digits,
  // and the last 6 digits are what a 6-digit app shows.
  const secret = base32Encode(Buffer.from("12345678901234567890"));

  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("at %i seconds the code is %s", (seconds, code) => {
    expect(codeAt(secret, counterAt(seconds))).toBe(code);
  });

  it("accepts one step of clock drift, and each code only once", () => {
    const s = newTotpSecret();
    const now = 1_800_000_000;
    const code = codeAt(s, counterAt(now - 30));
    const used = verifyCode(s, code, now, undefined);
    expect(used).toBe(counterAt(now - 30));
    expect(verifyCode(s, code, now, used)).toBeUndefined();
    expect(verifyCode(s, codeAt(s, counterAt(now - 90)), now, undefined)).toBeUndefined();
  });

  it("round-trips base32", () => {
    const bytes = Buffer.from("any bytes at all \x00\xff");
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });
});

describe("password rules", () => {
  it("wants length, not symbols, and refuses common or personal passwords", () => {
    expect(passwordProblem("short", "a@b.co")).toMatch(/at least 12/);
    expect(passwordProblem("aaaaaaaaaaaaaaa", "a@b.co")).toMatch(/different characters/);
    expect(passwordProblem("masterbating1", "a@b.co")).toBeUndefined(); // 13 chars, not listed
    expect(passwordProblem("unbelievable", "a@b.co")).toMatch(/common passwords/);
    expect(passwordProblem("ali.riaz-gold-2026", "ali.riaz@bank.test")).toMatch(/email/);
    expect(passwordProblem("my-mohar-account", "x@y.co")).toMatch(/MOHAR/);
    expect(passwordProblem(PASSWORD, "x@y.co")).toBeUndefined();
  });
});

describe("sealed secrets", () => {
  it("opens only with the same key and detects tampering", () => {
    const sealed = new Sealer("key-one-for-test").seal("JBSWY3DPEHPK3PXP");
    expect(new Sealer("key-one-for-test").open(sealed)).toBe("JBSWY3DPEHPK3PXP");
    expect(() => new Sealer("another-key-test").open(sealed)).toThrow();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => new Sealer("key-one-for-test").open(parts.join("."))).toThrow();
  });
});

describe("hash-chained logs", () => {
  it("verifies an untouched chain and finds the first edited entry", () => {
    const store = new PortalStore(null);
    for (let i = 0; i < 5; i += 1) store.log("audit", { action: `a${i}`, result: "ok" });
    expect(store.verifyLog("audit")).toEqual({ intact: true, entries: 5 });

    store.rawLog("audit")[2]!.action = "edited";
    expect(store.verifyLog("audit")).toMatchObject({ intact: false, firstBrokenSeq: 3 });
  });

  it("notices a deleted entry", () => {
    const store = new PortalStore(null);
    for (let i = 0; i < 4; i += 1) store.log("security", { action: `s${i}`, result: "ok" });
    store.rawLog("security").splice(1, 1);
    expect(store.verifyLog("security")).toMatchObject({ intact: false, firstBrokenSeq: 3 });
  });
});

describe("CSV export", () => {
  it("quotes fields and defuses spreadsheet formulas", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField('a,"b"')).toBe('"a,""b"""');
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvField("-5")).toBe("'-5");
    expect(csvField(undefined)).toBe("");
  });
});

describe("signing in", () => {
  it("sets a strict, HttpOnly session cookie and returns the user", async () => {
    const { app, codeFor } = await setup();
    const res = await request(app)
      .post("/portal/v1/session")
      .set("Origin", ORIGIN)
      .send({ email: "Dev@Bank.test ", password: PASSWORD, code: codeFor("dev@bank.test") });
    expect(res.status).toBe(200);
    const cookie = String(res.headers["set-cookie"]![0]);
    expect(cookie).toMatch(/^mohar_portal=[\w-]{43};/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(res.body.user).toEqual({
      id: "usr_devbanktest",
      email: "dev@bank.test",
      role: "developer",
      partner: "demo-bank",
    });
    expect(res.body.idleTimeoutSeconds).toBe(900);
  });

  it("refuses a sign-in with no Origin, or another site's", async () => {
    const { app, codeFor } = await setup();
    const body = { email: "dev@bank.test", password: PASSWORD, code: codeFor("dev@bank.test") };
    const none = await request(app).post("/portal/v1/session").send(body);
    expect(none.status).toBe(403);
    const evil = await request(app)
      .post("/portal/v1/session")
      .set("Origin", "https://evil.example")
      .send(body);
    expect(evil.status).toBe(403);
    expect(evil.body.error.code).toBe("forbidden");
  });

  it("gives the same answer for a wrong password, a wrong code and an unknown email", async () => {
    const { app, codeFor } = await setup();
    const attempt = (email: string, password: string, code: string) =>
      request(app).post("/portal/v1/session").set("Origin", ORIGIN).send({ email, password, code });
    const answers = await Promise.all([
      attempt("dev@bank.test", "wrong password here", codeFor("dev@bank.test")),
      attempt("dev@bank.test", PASSWORD, "000000"),
      attempt("nobody@bank.test", PASSWORD, "123456"),
    ]);
    for (const res of answers) {
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe("Email, password or code is wrong");
    }
  });

  it("does not accept the same code twice", async () => {
    const { app, codeFor } = await setup();
    const body = { email: "dev@bank.test", password: PASSWORD, code: codeFor("dev@bank.test") };
    const first = await request(app).post("/portal/v1/session").set("Origin", ORIGIN).send(body);
    expect(first.status).toBe(200);
    const replay = await request(app).post("/portal/v1/session").set("Origin", ORIGIN).send(body);
    expect(replay.status).toBe(401);
  });

  it("slows down after 5 failures and disables the account after 20", async () => {
    const { app, clock, portalStore } = await setup();
    const wrong = () =>
      request(app)
        .post("/portal/v1/session")
        .set("Origin", ORIGIN)
        .send({ email: "viewer@bank.test", password: "not the password", code: "000000" });

    for (let i = 0; i < 5; i += 1) expect((await wrong()).status).toBe(401);
    const slowed = await wrong();
    expect(slowed.status).toBe(429);
    expect(Number(slowed.headers["retry-after"])).toBeGreaterThan(0);

    for (let i = 5; i < 20; i += 1) {
      clock.now = new Date(clock.now.getTime() + 16 * 60_000); // past any wait
      expect((await wrong()).status).toBe(401);
    }
    clock.now = new Date(clock.now.getTime() + 16 * 60_000);
    const disabled = await wrong();
    expect(disabled.status).toBe(403);
    expect(portalStore.findUserByEmail("viewer@bank.test")?.status).toBe("disabled");
    expect(portalStore.rawLog("security").some((e) => e.action === "user.disabled")).toBe(true);
  });
});

describe("sessions", () => {
  it("end after 15 minutes idle and after 8 hours in all", async () => {
    const { app, clock, signIn } = await setup();
    let cookie = await signIn("viewer@bank.test");
    clock.now = new Date(clock.now.getTime() + 14 * 60_000);
    expect((await request(app).get("/portal/v1/me").set("Cookie", cookie)).status).toBe(200);
    clock.now = new Date(clock.now.getTime() + 16 * 60_000);
    expect((await request(app).get("/portal/v1/me").set("Cookie", cookie)).status).toBe(401);

    cookie = await signIn("viewer@bank.test");
    for (let minutes = 0; minutes < 8 * 60; minutes += 10) {
      clock.now = new Date(clock.now.getTime() + 10 * 60_000);
      await request(app).get("/portal/v1/me").set("Cookie", cookie);
    }
    expect((await request(app).get("/portal/v1/me").set("Cookie", cookie)).status).toBe(401);
  });

  it("end on sign-out, which needs the portal's Origin", async () => {
    const { app, signIn } = await setup();
    const cookie = await signIn("viewer@bank.test");
    const noOrigin = await request(app).delete("/portal/v1/session").set("Cookie", cookie);
    expect(noOrigin.status).toBe(403);
    const out = await request(app)
      .delete("/portal/v1/session")
      .set("Cookie", cookie)
      .set("Origin", ORIGIN);
    expect(out.status).toBe(204);
    expect((await request(app).get("/portal/v1/me").set("Cookie", cookie)).status).toBe(401);
  });

  it("never mix with API keys", async () => {
    const { app, signIn } = await setup();
    const cookie = await signIn("viewer@bank.test");
    expect((await request(app).get("/v1/price").set("Cookie", cookie)).status).toBe(401);
    const withKey = await request(app)
      .get("/portal/v1/overview")
      .set("Authorization", "Bearer mk_test_unit");
    expect(withKey.status).toBe(401);
  });
});

describe("each partner sees only its own data", () => {
  it("lists only its own wallets and transactions", async () => {
    const { app, signIn } = await setup();
    const cookie = await signIn("viewer@bank.test");
    const wallets = await request(app).get("/portal/v1/wallets").set("Cookie", cookie);
    expect(wallets.body.data.map((w: { id: string }) => w.id)).toEqual(["wal_bank1"]);
    const txns = await request(app).get("/portal/v1/transactions").set("Cookie", cookie);
    expect(txns.body.data.map((t: { id: string }) => t.id)).toEqual(["txn_bank1"]);
    const overview = await request(app).get("/portal/v1/overview").set("Cookie", cookie);
    expect(overview.body).toMatchObject({
      partner: "demo-bank",
      customers: 1,
      goldHeldGrams: "0.71557733",
      volume30DaysPkr: "25000.00",
      reserve: { fullyBacked: true },
    });
  });

  it.each([
    "/portal/v1/wallets/wal_other1",
    "/portal/v1/transactions/txn_other1",
    "/portal/v1/transactions?walletId=wal_other1",
  ])("answers 404 for another partner's %s", async (path) => {
    const { app, signIn } = await setup();
    const cookie = await signIn("viewer@bank.test");
    const res = await request(app).get(path).set("Cookie", cookie);
    expect(res.status).toBe(404);
  });

  it("shows a wallet's balance and limit use", async () => {
    const { app, signIn } = await setup();
    const cookie = await signIn("viewer@bank.test");
    const res = await request(app).get("/portal/v1/wallets/wal_bank1").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.limits.perTradePkr).toBe("25000.00");
    expect(res.body.limits.last30Days.usedPkr).toBe("25000.00");
    expect(res.body.status).toBe("active");
  });
});

describe("roles", () => {
  it("keeps the audit log and exports for compliance", async () => {
    const { app, signIn } = await setup();
    for (const email of ["viewer@bank.test", "dev@bank.test"]) {
      const cookie = await signIn(email);
      expect((await request(app).get("/portal/v1/audit").set("Cookie", cookie)).status).toBe(403);
      const csv = await request(app).get("/portal/v1/transactions.csv").set("Cookie", cookie);
      expect(csv.status).toBe(403);
    }
    const cookie = await signIn("comp@bank.test");
    const csv = await request(app).get("/portal/v1/transactions.csv").set("Cookie", cookie);
    expect(csv.status).toBe(200);
    expect(csv.text.split("\r\n")[1]).toMatch(/^txn_bank1,mint,confirmed,wal_bank1,/);
    expect(csv.text).not.toContain("txn_other1");

    const audit = await request(app).get("/portal/v1/audit").set("Cookie", cookie);
    expect(audit.status).toBe(200);
    const refusals = await request(app).get("/portal/v1/audit?log=security").set("Cookie", cookie);
    expect(
      refusals.body.data.filter((e: { action: string }) => e.action === "access.refused"),
    ).toHaveLength(4);
    expect(audit.body.data[0]).toMatchObject({
      action: "transactions.export",
      partner: "demo-bank",
    });
  });

  it("shows a compliance user only their own partner's log entries", async () => {
    const { app, signIn } = await setup();
    await signIn("viewer@bank.test");
    const cookie = await signIn("comp@wallet.test");
    const security = await request(app).get("/portal/v1/audit?log=security").set("Cookie", cookie);
    const partners = new Set(security.body.data.map((e: { partner: string }) => e.partner));
    expect([...partners]).toEqual(["moher-wallet"]);
  });

  it("keeps operators off partner pages, and lets them verify the logs", async () => {
    const { app, signIn } = await setup();
    const cookie = await signIn("ops@mohar.test");
    expect((await request(app).get("/portal/v1/overview").set("Cookie", cookie)).status).toBe(403);
    const verify = await request(app).get("/portal/v1/audit/verify").set("Cookie", cookie);
    expect(verify.status).toBe(200);
    expect(verify.body.security.intact).toBe(true);
    expect(verify.body.security.entries).toBeGreaterThan(0);
  });
});
