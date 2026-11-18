import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyWebhookSignature } from "@mohar/sdk";
import { describe, expect, it } from "vitest";
import type { Partner, TransactionRecord } from "../src/domain/types.js";
import { PortalStore } from "../src/portal/portal-store.js";
import { RETRY_SCHEDULE_MS, WebhookSender } from "../src/services/webhooks.js";

const txn = { id: "txn_retry1", status: "confirmed" } as unknown as TransactionRecord;
const MINUTE = 60_000;

function partner(secret = "whsec_retry_test_secret_one"): Partner {
  return {
    slug: "demo-bank",
    partnerId: "0x01",
    webhookUrl: "https://bank.example/hooks",
    webhookSecret: secret,
    ownsWebhookSecret: true,
  };
}

/** A sender whose clock the test moves, and a partner endpoint the test switches on and off. */
function harness(store = new PortalStore(null)) {
  const clock = { now: Date.parse("2026-11-18T10:00:00Z") };
  const endpoint = { up: false, received: [] as { body: string; signature: string }[] };
  const bank = partner();
  const make = () =>
    new WebhookSender((t) => ({ id: t.id, status: t.status }), {
      store,
      partner: () => bank,
      now: () => clock.now,
      random: () => 0.5, // no jitter
      post: async (_url, headers, body) => {
        endpoint.received.push({ body, signature: headers["Mohar-Signature"]! });
        return { status: endpoint.up ? 200 : 503 };
      },
    });
  return { clock, endpoint, store, bank, sender: make(), make };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const only = (store: PortalStore) => store.deliveriesOf("demo-bank")[0]!;

describe("webhook retries", () => {
  it("try again on schedule and stop once the partner answers", async () => {
    const { clock, endpoint, store, sender, bank } = harness();
    sender.send(bank, "transaction.confirmed", txn);
    await settle();
    expect(only(store)).toMatchObject({
      status: "pending",
      nextAttemptAt: "2026-11-18T10:01:00.000Z",
    });

    clock.now += 30_000;
    expect(await sender.sendDue()).toBe(0); // not due yet

    clock.now += 31_000;
    expect(await sender.sendDue()).toBe(1);
    expect(only(store)).toMatchObject({
      status: "pending",
      nextAttemptAt: "2026-11-18T10:05:00.000Z",
    });

    endpoint.up = true;
    clock.now = Date.parse("2026-11-18T10:05:01Z");
    await sender.sendDue();
    expect(only(store).status).toBe("delivered");
    expect(only(store).attempts.map((a) => a.statusCode)).toEqual([503, 503, 200]);
    expect(only(store).nextAttemptAt).toBeUndefined();
    // Every attempt carried the same event.
    expect(new Set(endpoint.received.map((r) => r.body)).size).toBe(1);
  });

  it("carry on after a restart, from the saved file", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "mohar-retry-")), "portal.json");
    const first = harness(new PortalStore(file));
    first.sender.send(first.bank, "transaction.confirmed", txn);
    await settle();

    // A new process: a new store read from the same file, a new sender.
    const again = harness(new PortalStore(file));
    again.endpoint.up = true;
    again.clock.now = Date.parse("2026-11-18T10:01:00Z");
    expect(await again.sender.sendDue()).toBe(1);
    expect(only(again.store)).toMatchObject({ status: "delivered" });
    expect(only(again.store).attempts).toHaveLength(2);
  });

  it("give up after 3 days and mark the delivery failed", async () => {
    const { clock, store, sender, bank } = harness();
    sender.send(bank, "transaction.failed", txn);
    await settle();
    for (const delay of RETRY_SCHEDULE_MS) {
      clock.now = Date.parse("2026-11-18T10:00:00Z") + delay + 1;
      await sender.sendDue();
    }
    expect(only(store).status).toBe("failed");
    expect(only(store).attempts).toHaveLength(RETRY_SCHEDULE_MS.length + 1);
    expect(RETRY_SCHEDULE_MS.at(-1)).toBe(72 * 60 * MINUTE);
  });

  it("sign each retry with the partner's current secret", async () => {
    const { clock, endpoint, sender, bank } = harness();
    sender.send(bank, "transaction.confirmed", txn);
    await settle();
    bank.webhookSecret = "whsec_retry_test_secret_two"; // rotated in the portal
    endpoint.up = true;
    clock.now += MINUTE + 1;
    await sender.sendDue();
    const retry = endpoint.received.at(-1)!;
    expect(
      verifyWebhookSignature({
        payload: retry.body,
        header: retry.signature,
        secret: "whsec_retry_test_secret_two",
      }).type,
    ).toBe("transaction.confirmed");
  });

  it("spread retries a little, so many failures do not all retry at once", async () => {
    const store = new PortalStore(null);
    const at = (random: number) =>
      new WebhookSender((t) => t, {
        store,
        random: () => random,
        now: () => Date.parse("2026-11-18T10:00:00Z"),
        post: async () => ({ status: 500 }),
      });
    await at(0).resend(partner(), { ...seed(), id: "dlv_a" });
    await at(1).resend(partner(), { ...seed(), id: "dlv_b" });
    const times = store.deliveriesOf("demo-bank").map((d) => Date.parse(d.nextAttemptAt!));
    expect(Math.abs(times[0]! - times[1]!)).toBe(24_000); // 60 s ± 20%
  });
});

function seed() {
  return {
    id: "dlv_seed",
    eventId: "evt_seed",
    partnerSlug: "demo-bank",
    transactionId: "txn_retry1",
    event: "transaction.confirmed",
    url: "https://bank.example/hooks",
    body: "{}",
    status: "failed" as const,
    attempts: [],
    createdAt: "2026-11-18T09:00:00Z",
  };
}
