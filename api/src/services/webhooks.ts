import { buildWebhookSignatureHeader } from "@mohar/sdk";
import type { Partner, TransactionRecord } from "../domain/types.js";
import { newId } from "../lib/ids.js";
import { safeTransport, type Transport } from "../lib/safe-post.js";
import type { WebhookDelivery } from "../portal/portal-store.js";

export type WebhookEventType = "transaction.confirmed" | "transaction.failed";

const RETRY_DELAYS_MS = [0, 1_000, 5_000];

/** Where deliveries are recorded, so the portal can list and resend them. */
export interface DeliveryRecorder {
  saveDelivery(delivery: WebhookDelivery): void;
}

export interface WebhookSenderOptions {
  /** How a webhook is posted. Default: safeTransport (SSRF checks, 15 s timeout). */
  post?: Transport;
  /** Allow http://localhost webhook URLs (the local demo). Ignored when `post` is given. */
  allowLoopback?: boolean;
  recorder?: DeliveryRecorder;
  retryDelaysMs?: number[];
}

/**
 * Sends signed webhooks to partners. Uses the SDK's signing helper, so the API and every
 * partner verify with exactly the same code. Each partner's events are signed with that
 * partner's own secret. Three attempts; a partner that misses one can poll
 * GET /v1/transactions/{id}, or resend it from the portal's delivery log.
 */
export class WebhookSender {
  private readonly post: Transport;
  private readonly delays: number[];

  constructor(
    private readonly present: (txn: TransactionRecord) => unknown,
    private readonly options: WebhookSenderOptions = {},
  ) {
    this.post = options.post ?? safeTransport({ allowLoopback: options.allowLoopback ?? false });
    this.delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  }

  send(partner: Partner, type: WebhookEventType, txn: TransactionRecord): void {
    if (!partner.webhookUrl) return;
    if (!partner.webhookSecret) {
      console.warn(`No webhook secret for ${partner.slug}; event for ${txn.id} not sent`);
      return;
    }
    const eventId = newId("evt");
    const body = JSON.stringify({
      id: eventId,
      type,
      createdAt: new Date().toISOString(),
      data: this.present(txn),
    });
    void this.deliver(partner, {
      id: newId("dlv"),
      eventId,
      partnerSlug: partner.slug,
      transactionId: txn.id,
      event: type,
      url: partner.webhookUrl,
      body,
      status: "pending",
      attempts: [],
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * Sends a recorded event again, to the partner's current URL and signed with its current
   * secret. Same event id, so a partner that did receive it can ignore the copy.
   */
  resend(partner: Partner, original: WebhookDelivery): Promise<WebhookDelivery> {
    if (!partner.webhookUrl || !partner.webhookSecret) {
      return Promise.reject(new Error("This partner has no webhook URL or secret"));
    }
    return this.deliver(partner, {
      ...original,
      id: newId("dlv"),
      url: partner.webhookUrl,
      status: "pending",
      attempts: [],
      createdAt: new Date().toISOString(),
      resendOf: original.id,
    });
  }

  private async deliver(partner: Partner, delivery: WebhookDelivery): Promise<WebhookDelivery> {
    const record = (d: WebhookDelivery) => this.options.recorder?.saveDelivery(d);
    record(delivery);
    for (const delay of this.delays) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const started = Date.now();
      const at = new Date().toISOString();
      try {
        const { status } = await this.post(
          delivery.url,
          {
            "Content-Type": "application/json",
            "Mohar-Signature": buildWebhookSignatureHeader(delivery.body, partner.webhookSecret!),
          },
          delivery.body,
        );
        delivery.attempts.push({ at, statusCode: status, ms: Date.now() - started });
        if (status >= 200 && status < 300) {
          delivery.status = "delivered";
          record(delivery);
          return delivery;
        }
      } catch (error) {
        delivery.attempts.push({
          at,
          error: error instanceof Error ? error.message : String(error),
          ms: Date.now() - started,
        });
      }
      record(delivery);
    }
    delivery.status = "failed";
    record(delivery);
    console.warn(`Webhook to ${delivery.url} failed after ${this.delays.length} attempts`);
    return delivery;
  }
}
