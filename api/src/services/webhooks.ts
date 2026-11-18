import { buildWebhookSignatureHeader } from "@mohar/sdk";
import type { Partner, TransactionRecord } from "../domain/types.js";
import { newId } from "../lib/ids.js";
import { safeTransport, type Transport } from "../lib/safe-post.js";
import type { WebhookDelivery } from "../portal/portal-store.js";

export type WebhookEventType = "transaction.confirmed" | "transaction.failed";

/**
 * When to try again after a failed attempt, measured from the first attempt. Roughly the
 * Standard Webhooks and Stripe pattern: quick retries first, then hours apart, for 3 days.
 */
export const RETRY_SCHEDULE_MS = [
  60_000, // 1 minute
  5 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  6 * 3_600_000,
  12 * 3_600_000,
  24 * 3_600_000,
  48 * 3_600_000,
  72 * 3_600_000, // last try 3 days after the first
];

/** Retries land up to this share early or late, so many failed events do not all retry at once. */
const JITTER = 0.2;

/** Where deliveries are kept, so retries survive a restart and the portal can list them. */
export interface DeliveryStore {
  saveDelivery(delivery: WebhookDelivery): void;
  /** Pending deliveries whose next attempt is due at or before `nowIso`. */
  dueDeliveries(nowIso: string): WebhookDelivery[];
}

export interface WebhookSenderOptions {
  /** How a webhook is posted. Default: safeTransport (SSRF checks, 15 s timeout). */
  post?: Transport;
  /** Allow http://localhost webhook URLs (the local demo). Ignored when `post` is given. */
  allowLoopback?: boolean;
  /** Keeps deliveries and their retries. Without it, each event gets one attempt only. */
  store?: DeliveryStore;
  /** Delays after the first attempt, from the first attempt. Default RETRY_SCHEDULE_MS. */
  retryScheduleMs?: number[];
  /** Finds a partner by slug when resuming saved retries. */
  partner?: (slug: string) => Partner | undefined;
  now?: () => number;
  random?: () => number;
}

/**
 * Sends signed webhooks to partners. Uses the SDK's signing helper, so the API and every
 * partner verify with exactly the same code. Each partner's events are signed with that
 * partner's own secret, at the time of each attempt (so a rotated secret applies to retries).
 *
 * The first attempt goes out at once. A failed one is saved with the time of its next try, and
 * a timer sends whatever is due, so retries carry on after a restart. After the last scheduled
 * try (3 days) the delivery is marked failed; the partner can poll GET /v1/transactions/{id} or
 * resend it from the portal.
 */
export class WebhookSender {
  private readonly post: Transport;
  private readonly schedule: number[];
  private readonly now: () => number;
  private readonly random: () => number;
  private timer: NodeJS.Timeout | undefined;
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly present: (txn: TransactionRecord) => unknown,
    private readonly options: WebhookSenderOptions = {},
  ) {
    this.post = options.post ?? safeTransport({ allowLoopback: options.allowLoopback ?? false });
    this.schedule = options.retryScheduleMs ?? RETRY_SCHEDULE_MS;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  send(partner: Partner, type: WebhookEventType, txn: TransactionRecord): void {
    if (!partner.webhookUrl) return;
    if (!partner.webhookSecret) {
      console.warn(`No webhook secret for ${partner.slug}; event for ${txn.id} not sent`);
      return;
    }
    const eventId = newId("evt");
    const createdAt = new Date(this.now()).toISOString();
    const body = JSON.stringify({ id: eventId, type, createdAt, data: this.present(txn) });
    void this.attempt(partner, {
      id: newId("dlv"),
      eventId,
      partnerSlug: partner.slug,
      transactionId: txn.id,
      event: type,
      url: partner.webhookUrl,
      body,
      status: "pending",
      attempts: [],
      createdAt,
    });
  }

  /**
   * Sends a recorded event again, to the partner's current URL and signed with its current
   * secret, with a fresh retry schedule. Same event id, so a partner that did receive it can
   * ignore the copy.
   */
  resend(partner: Partner, original: WebhookDelivery): Promise<WebhookDelivery> {
    if (!partner.webhookUrl || !partner.webhookSecret) {
      return Promise.reject(new Error("This partner has no webhook URL or secret"));
    }
    const { nextAttemptAt: _drop, ...rest } = original;
    return this.attempt(partner, {
      ...rest,
      id: newId("dlv"),
      url: partner.webhookUrl,
      status: "pending",
      attempts: [],
      createdAt: new Date(this.now()).toISOString(),
      resendOf: original.id,
    });
  }

  /** Starts the timer that sends retries as they fall due, including ones saved before a restart. */
  start(intervalMs = 15_000): void {
    if (this.timer || !this.options.store) return;
    this.timer = setInterval(() => void this.sendDue(), intervalMs);
    this.timer.unref();
    void this.sendDue();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Sends every saved retry that is due now. Returns how many it tried. */
  async sendDue(): Promise<number> {
    const store = this.options.store;
    if (!store) return 0;
    const due = store
      .dueDeliveries(new Date(this.now()).toISOString())
      .filter((d) => !this.inFlight.has(d.id));
    await Promise.all(
      due.map((delivery) => {
        const partner = this.options.partner?.(delivery.partnerSlug);
        if (!partner?.webhookSecret) {
          // The partner is gone or has no secret any more: nothing can be signed.
          this.save({ ...delivery, status: "failed", nextAttemptAt: undefined });
          return Promise.resolve();
        }
        return this.attempt(partner, delivery);
      }),
    );
    return due.length;
  }

  private save(delivery: WebhookDelivery): void {
    this.options.store?.saveDelivery(delivery);
  }

  /** One attempt; on failure, saves when to try next, or marks the delivery failed. */
  private async attempt(partner: Partner, delivery: WebhookDelivery): Promise<WebhookDelivery> {
    this.inFlight.add(delivery.id);
    const started = this.now();
    try {
      const { status } = await this.post(
        delivery.url,
        {
          "Content-Type": "application/json",
          "Mohar-Signature": buildWebhookSignatureHeader(delivery.body, partner.webhookSecret!),
        },
        delivery.body,
      );
      delivery.attempts.push({
        at: new Date(started).toISOString(),
        statusCode: status,
        ms: this.now() - started,
      });
      if (status >= 200 && status < 300) {
        const done: WebhookDelivery = {
          ...delivery,
          status: "delivered",
          nextAttemptAt: undefined,
        };
        this.save(done);
        return done;
      }
    } catch (error) {
      delivery.attempts.push({
        at: new Date(started).toISOString(),
        error: error instanceof Error ? error.message : String(error),
        ms: this.now() - started,
      });
    } finally {
      this.inFlight.delete(delivery.id);
    }

    const next = this.options.store ? this.schedule[delivery.attempts.length - 1] : undefined;
    if (next === undefined) {
      const failed: WebhookDelivery = { ...delivery, status: "failed", nextAttemptAt: undefined };
      this.save(failed);
      console.warn(
        `Webhook ${delivery.eventId} to ${delivery.url} failed after ${delivery.attempts.length} attempts`,
      );
      return failed;
    }
    const jitter = 1 + (this.random() * 2 - 1) * JITTER;
    const at = Date.parse(delivery.createdAt) + Math.round(next * jitter);
    const waiting: WebhookDelivery = {
      ...delivery,
      status: "pending",
      nextAttemptAt: new Date(Math.max(at, this.now() + 1_000)).toISOString(),
    };
    this.save(waiting);
    return waiting;
  }
}
