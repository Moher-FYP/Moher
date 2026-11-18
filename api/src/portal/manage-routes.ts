import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { ComplianceSigner } from "../chain/compliance.js";
import type { AppContext } from "../context.js";
import { ApiError } from "../errors.js";
import { newId } from "../lib/ids.js";
import { checkWebhookUrl, UnsafeUrlError } from "../lib/safe-post.js";
import type { WebhookSender } from "../services/webhooks.js";
import { sessionPartner, signedIn, type PortalAuth } from "./auth.js";
import { keyHash, newApiKey, newWebhookSecret } from "./keys.js";
import { generatePassword, hashPassword } from "./passwords.js";
import { newTotpSecret, otpauthUri } from "./totp.js";
import type {
  FreezeRequest,
  LogInput,
  PortalRole,
  PortalStore,
  PortalUserRecord,
  WebhookDelivery,
} from "./portal-store.js";
import type { Sealer } from "./sealed.js";

/** What the portal's managing routes need beyond the read routes. */
export interface PortalManageContext {
  store: PortalStore;
  auth: PortalAuth;
  sealer: Sealer;
  webhooks: WebhookSender;
  /** Absent when no compliance key is configured: freezes can be requested, not carried out. */
  compliance?: ComplianceSigner | undefined;
  allowLoopbackWebhooks: boolean;
}

const KeyBody = z.object({ name: z.string().trim().min(1).max(64) });
const WebhookBody = z.object({ url: z.string().max(2048) });
const FreezeBody = z.object({
  action: z.enum(["freeze", "unfreeze"]).default("freeze"),
  reason: z.string().trim().min(10).max(500),
});
const NewUserBody = z
  .object({
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
    role: z.enum(["viewer", "developer", "compliance", "operator"]),
    partner: z.string().min(1).max(64).optional(),
  })
  .refine((b) => (b.role === "operator") === (b.partner === undefined), {
    message: "Operators have no partner; every other role needs one",
  });
const DecisionBody = z.object({ note: z.string().trim().max(500).optional() });
const ListQuery = z.object({
  transactionId: z
    .string()
    .regex(/^txn_[A-Za-z0-9]+$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
    throw new ApiError(400, "invalid_request", message);
  }
  return result.data;
}

const presentDelivery = (d: WebhookDelivery) => ({
  id: d.id,
  eventId: d.eventId,
  transactionId: d.transactionId,
  event: d.event,
  url: d.url,
  status: d.status,
  attempts: d.attempts,
  createdAt: d.createdAt,
  ...(d.resendOf ? { resendOf: d.resendOf } : {}),
});

/**
 * Routes that change something: API keys and webhooks (developers), freeze requests
 * (compliance) and MOHAR's own admin view (operators). Every change goes in the audit log, and
 * every secret is returned once, in the response that creates it.
 */
export function portalManageRoutes(ctx: AppContext, portal: PortalManageContext): Router {
  const router = Router();
  const { auth, store, sealer } = portal;
  const signedInAs = auth.authenticate();
  const developer = [signedInAs, auth.requireRole("developer")];
  const compliance = [signedInAs, auth.requireRole("compliance")];
  const operator = [signedInAs, auth.requireRole("operator")];
  /** Requests being carried out on-chain, so a double click cannot send two transactions. */
  const inFlight = new Set<string>();

  function audit(
    req: Request,
    res: Response,
    entry: Omit<LogInput, "result"> & { result?: LogInput["result"] },
  ) {
    const { user } = signedIn(res);
    store.log("audit", {
      userId: user.id,
      email: user.email,
      partner: user.partnerSlug,
      result: "ok",
      ip: req.ip,
      ...entry,
    });
  }

  function partnerFor(res: Response) {
    const slug = sessionPartner(res);
    const partner = ctx.partners.get(slug);
    if (!partner) throw new ApiError(404, "not_found", `Partner ${slug} is not configured`);
    return partner;
  }

  // ---------------------------------------------------------------- API keys

  router.get("/portal/v1/api-keys", ...developer, (_req, res) => {
    const slug = sessionPartner(res);
    res.json({
      data: store.apiKeysOf(slug).map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        createdAt: k.createdAt,
        ...(k.lastUsedAt ? { lastUsedAt: k.lastUsedAt } : {}),
        ...(k.revokedAt ? { revokedAt: k.revokedAt } : {}),
        status: k.revokedAt ? "revoked" : "active",
      })),
      configured: ctx.partners.configuredKeyPrefixes(slug).map((prefix) => ({ prefix })),
    });
  });

  router.post("/portal/v1/api-keys", ...developer, (req, res) => {
    const { name } = parse(KeyBody, req.body);
    const slug = sessionPartner(res);
    const key = newApiKey();
    const record = {
      id: newId("key"),
      partnerSlug: slug,
      name,
      prefix: key.slice(0, 12),
      hash: keyHash(key),
      createdAt: new Date().toISOString(),
      createdBy: signedIn(res).user.id,
    };
    store.saveApiKey(record);
    audit(req, res, {
      action: "api_key.create",
      target: record.id,
      detail: { name, prefix: record.prefix },
    });
    res.status(201).json({
      apiKey: {
        id: record.id,
        name,
        prefix: record.prefix,
        createdAt: record.createdAt,
        status: "active",
      },
      key,
    });
  });

  router.post("/portal/v1/api-keys/:keyId/revoke", ...developer, (req, res) => {
    const record = store.getApiKey(String(req.params.keyId));
    if (!record || record.partnerSlug !== sessionPartner(res)) {
      throw new ApiError(404, "not_found", `API key ${req.params.keyId} not found`);
    }
    if (!record.revokedAt) {
      store.updateApiKey(record.id, {
        revokedAt: new Date().toISOString(),
        revokedBy: signedIn(res).user.id,
      });
      audit(req, res, {
        action: "api_key.revoke",
        target: record.id,
        detail: { prefix: record.prefix },
      });
    }
    res.status(204).end();
  });

  // ---------------------------------------------------------------- webhooks

  router.get("/portal/v1/webhook", ...developer, (_req, res) => {
    const partner = partnerFor(res);
    const settings = store.partnerSettings(partner.slug);
    res.json({
      ...(partner.webhookUrl ? { url: partner.webhookUrl } : {}),
      secretSet: Boolean(partner.webhookSecret && partner.ownsWebhookSecret),
      ...(settings.webhookSecretSetAt ? { secretSetAt: settings.webhookSecretSetAt } : {}),
      localhostAllowed: portal.allowLoopbackWebhooks,
    });
  });

  router.put("/portal/v1/webhook", ...developer, (req, res) => {
    const { url } = parse(WebhookBody, req.body);
    let checked: URL;
    try {
      checked = checkWebhookUrl(url, portal.allowLoopbackWebhooks);
    } catch (error) {
      if (error instanceof UnsafeUrlError)
        throw new ApiError(400, "invalid_request", error.message);
      throw error;
    }
    const partner = partnerFor(res);
    const before = partner.webhookUrl;
    partner.webhookUrl = checked.toString();
    store.updatePartnerSettings(partner.slug, { webhookUrl: partner.webhookUrl });
    audit(req, res, {
      action: "webhook.url_change",
      target: partner.slug,
      detail: { before: before ?? null, after: partner.webhookUrl },
    });
    res.json({ url: partner.webhookUrl });
  });

  router.post("/portal/v1/webhook/rotate-secret", ...developer, (req, res) => {
    const partner = partnerFor(res);
    const secret = newWebhookSecret();
    const setAt = new Date().toISOString();
    partner.webhookSecret = secret;
    partner.ownsWebhookSecret = true;
    store.updatePartnerSettings(partner.slug, {
      webhookSecretSealed: sealer.seal(secret),
      webhookSecretSetAt: setAt,
    });
    audit(req, res, { action: "webhook.secret_rotate", target: partner.slug });
    res.json({ secret, secretSetAt: setAt });
  });

  router.get("/portal/v1/webhook/deliveries", ...developer, (req, res) => {
    const query = parse(ListQuery, req.query);
    const all = store.deliveriesOf(sessionPartner(res), query.transactionId);
    const start = query.cursor ? all.findIndex((d) => d.id === query.cursor) + 1 : 0;
    const data = all.slice(start, start + query.limit);
    const last = data.at(-1);
    res.json({
      data: data.map(presentDelivery),
      ...(last && start + query.limit < all.length ? { nextCursor: last.id } : {}),
    });
  });

  router.post(
    "/portal/v1/webhook/deliveries/:deliveryId/resend",
    ...developer,
    async (req, res) => {
      const original = store.getDelivery(String(req.params.deliveryId));
      if (!original || original.partnerSlug !== sessionPartner(res)) {
        throw new ApiError(404, "not_found", `Delivery ${req.params.deliveryId} not found`);
      }
      const partner = partnerFor(res);
      if (!partner.webhookUrl || !partner.webhookSecret) {
        throw new ApiError(409, "invalid_request", "Set a webhook URL and secret first");
      }
      const pending = portal.webhooks.resend(partner, original);
      audit(req, res, {
        action: "webhook.resend",
        target: original.id,
        detail: { eventId: original.eventId },
      });
      // The first attempt is usually quick; the answer does not wait for retries.
      const first = await Promise.race([
        pending,
        new Promise<undefined>((resolve) => setTimeout(resolve, 2_000, undefined)),
      ]);
      const latest = store.deliveriesOf(partner.slug, original.transactionId)[0];
      res.status(202).json(presentDelivery(first ?? latest ?? original));
    },
  );

  // ---------------------------------------------------------------- freezes

  router.post("/portal/v1/wallets/:walletId/freeze-requests", ...compliance, (req, res) => {
    const body = parse(FreezeBody, req.body);
    const wallet = ctx.store.getWallet(String(req.params.walletId));
    if (!wallet || wallet.partnerSlug !== sessionPartner(res)) {
      throw new ApiError(404, "not_found", `Wallet ${req.params.walletId} not found`);
    }
    const open = store
      .freezeRequests(wallet.partnerSlug)
      .find((r) => r.walletId === wallet.id && r.status === "pending");
    if (open)
      throw new ApiError(
        409,
        "invalid_request",
        `Request ${open.id} for this wallet is still open`,
      );
    const request: FreezeRequest = {
      id: newId("frz"),
      partnerSlug: wallet.partnerSlug,
      walletId: wallet.id,
      action: body.action,
      reason: body.reason,
      requestedBy: signedIn(res).user.id,
      requestedAt: new Date().toISOString(),
      status: "pending",
    };
    store.saveFreezeRequest(request);
    audit(req, res, {
      action: `wallet.${body.action}_request`,
      target: wallet.id,
      detail: { requestId: request.id },
    });
    res.status(201).json(request);
  });

  router.get(
    "/portal/v1/freeze-requests",
    signedInAs,
    auth.requireRole("compliance", "operator"),
    (_req, res) => {
      const { user } = signedIn(res);
      res.json({
        data: store.freezeRequests(user.role === "operator" ? undefined : sessionPartner(res)),
      });
    },
  );

  // ---------------------------------------------------------------- operator

  router.get("/portal/v1/admin/partners", ...operator, async (_req, res) => {
    const data = await Promise.all(
      ctx.partners.all().map(async (p) => ({
        slug: p.slug,
        partnerId: p.partnerId,
        activeOnChain: await ctx.chain.isPartnerActive(p.partnerId),
        customers: ctx.store.walletsOf(p.slug).length,
        ...(p.webhookUrl ? { webhookUrl: p.webhookUrl } : {}),
      })),
    );
    res.json({ data, complianceKey: portal.compliance?.address ?? null });
  });

  router.post(
    "/portal/v1/admin/freeze-requests/:requestId/approve",
    ...operator,
    async (req, res) => {
      parse(DecisionBody, req.body ?? {});
      const request = pendingRequest(String(req.params.requestId));
      const wallet = ctx.store.getWallet(request.walletId);
      if (!wallet) throw new ApiError(404, "not_found", `Wallet ${request.walletId} not found`);
      if (!portal.compliance) {
        throw new ApiError(
          501,
          "not_implemented",
          "No compliance key is configured (COMPLIANCE_PRIVATE_KEY), so freezes cannot be carried out",
        );
      }
      if (inFlight.has(request.id)) {
        throw new ApiError(409, "invalid_request", `Request ${request.id} is being carried out`);
      }
      inFlight.add(request.id);
      const decidedBy = signedIn(res).user.id;
      try {
        const txHash =
          request.action === "freeze"
            ? await portal.compliance.freeze(wallet.address, request.id)
            : await portal.compliance.unfreeze(wallet.address);
        const done: FreezeRequest = {
          ...request,
          status: "done",
          decidedBy,
          decidedAt: new Date().toISOString(),
          txHash,
        };
        store.saveFreezeRequest(done);
        audit(req, res, {
          action: `wallet.${request.action}`,
          target: wallet.id,
          partner: wallet.partnerSlug,
          detail: { requestId: request.id, txHash },
        });
        res.json(done);
      } catch (error) {
        const failure = error instanceof Error ? error.message.split("\n")[0]! : String(error);
        const failed: FreezeRequest = {
          ...request,
          status: "failed",
          decidedBy,
          decidedAt: new Date().toISOString(),
          failure,
        };
        store.saveFreezeRequest(failed);
        audit(req, res, {
          action: `wallet.${request.action}`,
          target: wallet.id,
          partner: wallet.partnerSlug,
          result: "failed",
          detail: { requestId: request.id, failure },
        });
        throw new ApiError(
          502,
          "internal_error",
          `The chain refused the ${request.action}: ${failure}`,
        );
      } finally {
        inFlight.delete(request.id);
      }
    },
  );

  router.post("/portal/v1/admin/freeze-requests/:requestId/reject", ...operator, (req, res) => {
    const { note } = parse(DecisionBody, req.body ?? {});
    const request = pendingRequest(String(req.params.requestId));
    const rejected: FreezeRequest = {
      ...request,
      status: "rejected",
      decidedBy: signedIn(res).user.id,
      decidedAt: new Date().toISOString(),
      ...(note ? { failure: note } : {}),
    };
    store.saveFreezeRequest(rejected);
    audit(req, res, {
      action: `wallet.${request.action}_reject`,
      target: request.walletId,
      partner: request.partnerSlug,
      detail: { requestId: request.id },
    });
    res.json(rejected);
  });

  // ---------------------------------------------------------------- operator: people

  const presentUser = (u: PortalUserRecord) => ({
    id: u.id,
    email: u.email,
    role: u.role,
    ...(u.partnerSlug ? { partner: u.partnerSlug } : {}),
    status: u.status,
    failedAttempts: u.failedAttempts,
    ...(u.lastFailedAt ? { lastFailedAt: u.lastFailedAt } : {}),
    createdAt: u.createdAt,
  });

  /** A new password and authenticator key, returned once. Ends the user's sessions. */
  async function issueSecrets(user: PortalUserRecord) {
    const password = generatePassword(user.email);
    const totpSecret = newTotpSecret();
    store.updateUser(user.id, {
      passwordHash: await hashPassword(password),
      totpSecretSealed: sealer.seal(totpSecret),
      totpLastCounter: undefined,
      status: "active",
      failedAttempts: 0,
    });
    store.deleteSessionsOf(user.id);
    return { password, setupKey: totpSecret, otpauthUri: otpauthUri(totpSecret, user.email) };
  }

  function otherUser(res: Response, id: string): PortalUserRecord {
    const user = store.getUser(id);
    if (!user) throw new ApiError(404, "not_found", `User ${id} not found`);
    if (user.id === signedIn(res).user.id) {
      throw new ApiError(409, "invalid_request", "Use another operator to change your own account");
    }
    return user;
  }

  router.get("/portal/v1/admin/users", ...operator, (_req, res) => {
    const users = store
      .allUsers()
      .sort(
        (a, b) =>
          (a.partnerSlug ?? "").localeCompare(b.partnerSlug ?? "") ||
          a.email.localeCompare(b.email),
      );
    res.json({ data: users.map(presentUser) });
  });

  router.post("/portal/v1/admin/users", ...operator, async (req, res) => {
    const body = parse(NewUserBody, req.body);
    if (body.partner && !ctx.partners.get(body.partner)) {
      throw new ApiError(400, "invalid_request", `No partner "${body.partner}"`);
    }
    if (store.findUserByEmail(body.email)) {
      throw new ApiError(409, "invalid_request", `${body.email} already has an account`);
    }
    const user: PortalUserRecord = {
      id: newId("usr"),
      email: body.email,
      ...(body.partner ? { partnerSlug: body.partner } : {}),
      role: body.role as PortalRole,
      passwordHash: "",
      totpSecretSealed: "",
      status: "active",
      failedAttempts: 0,
      createdAt: new Date().toISOString(),
    };
    store.saveUser(user);
    const secrets = await issueSecrets(user);
    audit(req, res, {
      action: "user.create",
      target: user.id,
      partner: body.partner,
      detail: { email: body.email, role: body.role },
    });
    res.status(201).json({ user: presentUser(store.getUser(user.id)!), ...secrets });
  });

  router.post("/portal/v1/admin/users/:userId/reset", ...operator, async (req, res) => {
    const user = otherUser(res, String(req.params.userId));
    const secrets = await issueSecrets(user);
    audit(req, res, {
      action: "user.reset",
      target: user.id,
      partner: user.partnerSlug,
      detail: { email: user.email },
    });
    res.json({ user: presentUser(store.getUser(user.id)!), ...secrets });
  });

  router.post("/portal/v1/admin/users/:userId/enable", ...operator, (req, res) => {
    const user = otherUser(res, String(req.params.userId));
    store.updateUser(user.id, { status: "active", failedAttempts: 0 });
    audit(req, res, {
      action: "user.enable",
      target: user.id,
      partner: user.partnerSlug,
      detail: { email: user.email },
    });
    res.json(presentUser(store.getUser(user.id)!));
  });

  router.post("/portal/v1/admin/users/:userId/disable", ...operator, (req, res) => {
    const user = otherUser(res, String(req.params.userId));
    store.updateUser(user.id, { status: "disabled" });
    store.deleteSessionsOf(user.id);
    audit(req, res, {
      action: "user.disable",
      target: user.id,
      partner: user.partnerSlug,
      detail: { email: user.email },
    });
    res.json(presentUser(store.getUser(user.id)!));
  });

  function pendingRequest(id: string): FreezeRequest {
    const request = store.getFreezeRequest(id);
    if (!request) throw new ApiError(404, "not_found", `Freeze request ${id} not found`);
    if (request.status !== "pending") {
      throw new ApiError(409, "invalid_request", `Request ${id} is already ${request.status}`);
    }
    return request;
  }

  return router;
}
