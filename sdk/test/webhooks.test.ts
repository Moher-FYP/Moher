import { describe, expect, it } from "vitest";
import {
  MoharWebhookError,
  buildWebhookSignatureHeader,
  verifyWebhookSignature,
} from "../src/index.js";

const secret = "whsec_test";
const payload = JSON.stringify({
  id: "evt_1",
  type: "transaction.confirmed",
  createdAt: "2026-10-01T00:00:00Z",
  data: {
    id: "txn_1",
    type: "mint",
    status: "confirmed",
    walletId: "wal_1",
    grams: "0.60410000",
    createdAt: "2026-10-01T00:00:00Z",
  },
});

describe("webhooks", () => {
  it("accepts a correctly signed, fresh event", () => {
    const now = 1_759_262_400;
    const header = buildWebhookSignatureHeader(payload, secret, now);

    const event = verifyWebhookSignature({ payload, header, secret, now: now + 10 });

    expect(event.type).toBe("transaction.confirmed");
    expect(event.data.id).toBe("txn_1");
  });

  it("rejects a tampered payload", () => {
    const now = 1_759_262_400;
    const header = buildWebhookSignatureHeader(payload, secret, now);
    const tampered = payload.replace("0.60410000", "60.41000000");

    expect(() => verifyWebhookSignature({ payload: tampered, header, secret, now })).toThrow(
      MoharWebhookError,
    );
  });

  it("rejects the wrong secret", () => {
    const now = 1_759_262_400;
    const header = buildWebhookSignatureHeader(payload, "whsec_other", now);

    expect(() => verifyWebhookSignature({ payload, header, secret, now })).toThrow(
      MoharWebhookError,
    );
  });

  it("rejects stale events (replay protection)", () => {
    const signedAt = 1_759_262_400;
    const header = buildWebhookSignatureHeader(payload, secret, signedAt);

    expect(() => verifyWebhookSignature({ payload, header, secret, now: signedAt + 301 })).toThrow(
      /tolerance/,
    );
  });

  it("rejects missing or malformed headers", () => {
    expect(() => verifyWebhookSignature({ payload, header: undefined, secret })).toThrow(
      MoharWebhookError,
    );
    expect(() => verifyWebhookSignature({ payload, header: "garbage", secret })).toThrow(
      MoharWebhookError,
    );
  });
});
