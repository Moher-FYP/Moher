import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../errors.js";
import { RateLimiter, tooManyRequests } from "../http/rate-limit.js";
import { dummyHash, verifyPassword } from "./passwords.js";
import type { PortalRole, PortalStore, PortalUserRecord, SessionRecord } from "./portal-store.js";
import type { Sealer } from "./sealed.js";
import { verifyCode } from "./totp.js";

export const COOKIE_NAME = "mohar_portal";

/** OWASP Session Management: both an idle limit and an absolute one. */
export const IDLE_SECONDS = 15 * 60;
export const ABSOLUTE_SECONDS = 8 * 60 * 60;

/** NIST SP 800-63B-4 allows at most 100 failures in a row; we stop at 20 and slow down from 5. */
export const SLOW_DOWN_AFTER = 5;
export const DISABLE_AFTER = 20;
const MAX_WAIT_SECONDS = 15 * 60;

export interface PortalAuthOptions {
  /** Origins the portal is served from, e.g. http://localhost:3002. Changes from others are refused. */
  origins: string[];
  /** False only when the portal runs on http://localhost. */
  secureCookies: boolean;
  /** Sign-in attempts per IP address per 15 minutes. */
  attemptsPerIp?: number;
  now?: () => Date;
}

export interface SignedIn {
  user: PortalUserRecord;
  session: SessionRecord;
}

/** How long an account must wait before the next attempt, in seconds (0 = may try now). */
export function waitSeconds(user: PortalUserRecord, now: Date): number {
  if (user.failedAttempts < SLOW_DOWN_AFTER || !user.lastFailedAt) return 0;
  const wait = Math.min(2 ** (user.failedAttempts - SLOW_DOWN_AFTER), MAX_WAIT_SECONDS);
  const ready = Date.parse(user.lastFailedAt) + wait * 1000;
  return Math.max(0, Math.ceil((ready - now.getTime()) / 1000));
}

export class PortalAuth {
  private readonly perIp: RateLimiter;
  private readonly now: () => Date;

  constructor(
    private readonly store: PortalStore,
    private readonly sealer: Sealer,
    readonly options: PortalAuthOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.perIp = new RateLimiter(options.attemptsPerIp ?? 30, 15 * 60_000, () =>
      this.now().getTime(),
    );
  }

  /**
   * Checks email, password and one-time code together and answers the same way whichever was
   * wrong. Every outcome goes in the security log.
   */
  async signIn(
    res: Response,
    input: { email: string; password: string; code: string },
    ip: string | undefined,
  ): Promise<{ token: string; signedIn: SignedIn }> {
    const email = input.email.trim().toLowerCase();
    const refuse = (reason: string, user?: PortalUserRecord) => {
      this.store.log("security", {
        userId: user?.id,
        email,
        partner: user?.partnerSlug,
        action: "session.create",
        result: "refused",
        detail: { reason },
        ip,
      });
    };

    const ipWait = this.perIp.take(ip ?? "unknown");
    if (ipWait > 0) {
      refuse("too_many_attempts_from_ip");
      throw tooManyRequests(res, ipWait, "sign-in attempts");
    }

    const user = this.store.findUserByEmail(email);
    if (!user) {
      await verifyPassword(await dummyHash(), input.password); // same time as a real check
      refuse("unknown_email");
      throw wrongDetails();
    }
    if (user.status === "disabled") {
      refuse("account_disabled", user);
      throw new ApiError(403, "forbidden", "This account is disabled. Ask MOHAR to re-enable it.");
    }
    const wait = waitSeconds(user, this.now());
    if (wait > 0) {
      refuse("slowed_down", user);
      throw tooManyRequests(res, wait, "sign-in attempts");
    }

    const passwordOk = await verifyPassword(user.passwordHash, input.password);
    const counter = verifyCode(
      this.sealer.open(user.totpSecretSealed),
      input.code,
      Math.floor(this.now().getTime() / 1000),
      user.totpLastCounter,
    );
    if (!passwordOk || counter === undefined) {
      const failedAttempts = user.failedAttempts + 1;
      const disabled = failedAttempts >= DISABLE_AFTER;
      this.store.updateUser(user.id, {
        failedAttempts,
        lastFailedAt: this.now().toISOString(),
        ...(disabled ? { status: "disabled" as const } : {}),
      });
      refuse(passwordOk ? "wrong_code" : "wrong_password", user);
      if (disabled) {
        this.store.log("security", {
          userId: user.id,
          email,
          partner: user.partnerSlug,
          action: "user.disabled",
          result: "ok",
          detail: { reason: `${DISABLE_AFTER} failed sign-ins in a row` },
          ip,
        });
      }
      throw wrongDetails();
    }

    const updated = this.store.updateUser(user.id, {
      failedAttempts: 0,
      totpLastCounter: counter,
    });
    // A new token at every sign-in: nothing set before sign-in carries over (session fixation).
    const token = randomBytes(32).toString("base64url");
    const at = this.now();
    const session: SessionRecord = {
      tokenHash: tokenHash(token),
      userId: user.id,
      createdAt: at.toISOString(),
      expiresAt: new Date(at.getTime() + ABSOLUTE_SECONDS * 1000).toISOString(),
      lastSeenAt: at.toISOString(),
      ...(ip ? { ip } : {}),
    };
    this.store.pruneSessions((s) => this.isLive(s));
    this.store.saveSession(session);
    this.store.log("security", {
      userId: user.id,
      email,
      partner: user.partnerSlug,
      action: "session.create",
      result: "ok",
      ip,
    });
    return { token, signedIn: { user: updated, session } };
  }

  signOut(signedIn: SignedIn, ip: string | undefined): void {
    this.store.deleteSession(signedIn.session.tokenHash);
    this.store.log("security", {
      userId: signedIn.user.id,
      email: signedIn.user.email,
      partner: signedIn.user.partnerSlug,
      action: "session.delete",
      result: "ok",
      ip,
    });
  }

  isLive(session: SessionRecord): boolean {
    const now = this.now().getTime();
    return (
      now < Date.parse(session.expiresAt) &&
      now - Date.parse(session.lastSeenAt) < IDLE_SECONDS * 1000
    );
  }

  /** Middleware: a live session for an active user, or 401. Puts both on res.locals. */
  authenticate() {
    return (req: Request, res: Response, next: NextFunction): void => {
      const token = readCookie(req.header("cookie"), COOKIE_NAME);
      const hash = token ? tokenHash(token) : undefined;
      const session = hash ? this.store.getSession(hash) : undefined;
      const user = session ? this.store.getUser(session.userId) : undefined;
      if (!session || !user || !this.isLive(session) || user.status !== "active") {
        if (session && !this.isLive(session)) this.store.deleteSession(session.tokenHash);
        res.setHeader("Set-Cookie", this.clearCookie());
        next(new ApiError(401, "unauthorized", "Not signed in, or the session has ended"));
        return;
      }
      this.store.touchSession(session.tokenHash, this.now().toISOString());
      res.locals.portal = { user, session } satisfies SignedIn;
      next();
    };
  }

  /**
   * Middleware for POST, PUT and DELETE: the Origin header must be one of the portal's own.
   * With SameSite=Strict this stops another site making a signed-in browser send a change.
   */
  sameOrigin() {
    const allowed = new Set(this.options.origins);
    return (req: Request, _res: Response, next: NextFunction): void => {
      if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
        next();
        return;
      }
      const origin = req.header("origin");
      if (origin && allowed.has(origin)) {
        next();
        return;
      }
      this.store.log("security", {
        action: "origin.refused",
        target: `${req.method} ${req.path}`,
        result: "refused",
        detail: { origin: origin ?? null },
        ip: req.ip,
      });
      next(new ApiError(403, "forbidden", "Changes must come from the portal itself"));
    };
  }

  /** Middleware: the signed-in user has one of these roles. A refusal goes in the security log. */
  requireRole(...roles: PortalRole[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
      const { user } = signedIn(res);
      if (roles.includes(user.role)) {
        next();
        return;
      }
      this.store.log("security", {
        userId: user.id,
        email: user.email,
        partner: user.partnerSlug,
        action: "access.refused",
        target: `${req.method} ${req.path}`,
        result: "refused",
        detail: { role: user.role },
        ip: req.ip,
      });
      next(new ApiError(403, "forbidden", "Your role cannot do this"));
    };
  }

  sessionCookie(token: string): string {
    return [
      `${COOKIE_NAME}=${token}`,
      "Path=/portal",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${ABSOLUTE_SECONDS}`,
      ...(this.options.secureCookies ? ["Secure"] : []),
    ].join("; ");
  }

  clearCookie(): string {
    return [
      `${COOKIE_NAME}=`,
      "Path=/portal",
      "HttpOnly",
      "SameSite=Strict",
      "Max-Age=0",
      ...(this.options.secureCookies ? ["Secure"] : []),
    ].join("; ");
  }
}

/** Which roles include which. A developer or compliance user can do everything a viewer can. */
export const VIEWERS: PortalRole[] = ["viewer", "developer", "compliance"];
export const COMPLIANCE: PortalRole[] = ["compliance"];

export function signedIn(res: Response): SignedIn {
  return res.locals.portal as SignedIn;
}

/** The partner of the signed-in user. Comes from the session, never from the request. */
export function sessionPartner(res: Response): string {
  const slug = signedIn(res).user.partnerSlug;
  if (!slug) throw new ApiError(403, "forbidden", "This page is for partner users");
  return slug;
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function wrongDetails(): ApiError {
  return new ApiError(401, "unauthorized", "Email, password or code is wrong");
}

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim() || undefined;
  }
  return undefined;
}
