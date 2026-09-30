import { buildWebhookSignatureHeader } from "@mohar/sdk";
import type { Partner, TransactionRecord } from "../domain/types.js";
import { newId } from "../lib/ids.js";

export type WebhookEventType = "transaction.confirmed" | "transaction.failed";

const RETRY_DELAYS_MS = [0, 1_000, 5_000];

/**
 * Sends signed webhooks to partners. Uses the SDK's signing helper, so the API and every
 * partner verify with exactly the same code. Delivery is best effort with three attempts; a
 * partner that misses one can always poll GET /v1/transactions/{id}.
 */
export class WebhookSender {
  constructor(
    private readonly secret: string,
    private readonly present: (txn: TransactionRecord) => unknown,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  send(partner: Partner, type: WebhookEventType, txn: TransactionRecord): void {
    if (!partner.webhookUrl) return;
    const body = JSON.stringify({
      id: newId("evt"),
      type,
      createdAt: new Date().toISOString(),
      data: this.present(txn),
    });
    void this.deliver(partner.webhookUrl, body);
  }

  private async deliver(url: string, body: string): Promise<void> {
    for (const delay of RETRY_DELAYS_MS) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const response = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Mohar-Signature": buildWebhookSignatureHeader(body, this.secret),
          },
          body,
        });
        if (response.ok) return;
      } catch {
        // retry
      }
    }
    console.warn(`Webhook to ${url} failed after ${RETRY_DELAYS_MS.length} attempts`);
  }
}
