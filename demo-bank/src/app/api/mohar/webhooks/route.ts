import { MoharWebhookError, verifyWebhookSignature } from "@mohar/sdk";
import { record } from "@/lib/devlog";

/**
 * MOHAR calls this when a trade settles. The SDK verifies the signature against the shared
 * secret; anything unsigned or tampered with is rejected. A real bank would credit or debit the
 * customer's PKR account here; the demo records the event for the "Behind the scenes" panel.
 */
export async function POST(request: Request) {
  const payload = await request.text();
  try {
    const event = verifyWebhookSignature({
      payload,
      header: request.headers.get("mohar-signature"),
      secret: process.env.MOHAR_WEBHOOK_SECRET ?? "whsec_local_dev_only",
    });
    record({
      kind: "webhook",
      at: new Date().toISOString(),
      type: event.type,
      verified: true,
      transactionId: event.data.id,
      status: event.data.status,
    });
    return new Response(null, { status: 200 });
  } catch (error) {
    const message = error instanceof MoharWebhookError ? error.message : "Bad webhook";
    record({
      kind: "webhook",
      at: new Date().toISOString(),
      type: "rejected",
      verified: false,
      reason: message,
    });
    return Response.json({ error: message }, { status: 400 });
  }
}
