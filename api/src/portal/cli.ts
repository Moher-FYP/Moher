import { randomBytes } from "node:crypto";
import { createConnection } from "node:net";
import { join } from "node:path";
import { parseArgs } from "node:util";
import QRCode from "qrcode";
import { loadConfig } from "../config.js";
import { PartnerDirectory } from "../http/auth.js";
import { newId } from "../lib/ids.js";
import { LOCAL_ONLY } from "../secrets.js";
import { hashPassword, passwordProblem } from "./passwords.js";
import { PortalStore, type PortalRole } from "./portal-store.js";
import { Sealer } from "./sealed.js";
import { newTotpSecret, otpauthUri } from "./totp.js";

/**
 * Manages portal users from the terminal, so the first users (and MOHAR's operators) exist
 * before anyone can sign in. Prints a new user's password and authenticator key once, to this
 * terminal only; they are never written anywhere else. Put them in the password manager.
 *
 *   pnpm --filter @mohar/api portal:user add --email ali@demo-bank.test --role developer --partner demo-bank
 *   pnpm --filter @mohar/api portal:user add --email ops@mohar.test --role operator
 *   pnpm --filter @mohar/api portal:user list
 *   pnpm --filter @mohar/api portal:user enable --email ali@demo-bank.test
 *   pnpm --filter @mohar/api portal:user disable --email ali@demo-bank.test
 *   pnpm --filter @mohar/api portal:user reset --email ali@demo-bank.test
 *
 * For Amoy, prefix with DOTENV_CONFIG_PATH=.env.amoy, as for the API itself.
 */

const ROLES: PortalRole[] = ["viewer", "developer", "compliance", "operator"];

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    email: { type: "string" },
    role: { type: "string" },
    partner: { type: "string" },
  },
});

const config = loadConfig();

async function main(): Promise<void> {
  const command = positionals[0];
  if (!command || !["add", "list", "enable", "disable", "reset"].includes(command)) {
    fail("Use one of: add, list, enable, disable, reset (see the top of src/portal/cli.ts)");
  }
  if (await apiIsRunning()) {
    fail(
      `The API is running on port ${config.PORT}. Stop it first: it keeps the portal file in ` +
        "memory and would overwrite this change when it next saves.",
    );
  }
  if (!config.PORTAL_SECRET_KEY) {
    console.warn(
      "PORTAL_SECRET_KEY is not set: using the public local default (local Anvil only).",
    );
  }
  const sealer = new Sealer(config.PORTAL_SECRET_KEY ?? LOCAL_ONLY.portalSecretKey);
  const store = new PortalStore(join(config.DATA_DIR, "portal.json"));
  const audit = (action: string, email: string, partner?: string) =>
    store.log("audit", { email, partner, action, result: "ok", detail: { by: "cli" } });

  if (command === "list") {
    const users = store.allUsers();
    if (users.length === 0) console.log("No portal users yet.");
    for (const u of users) {
      console.log(
        `${u.email.padEnd(32)} ${u.role.padEnd(10)} ${(u.partnerSlug ?? "-").padEnd(14)} ${u.status}` +
          (u.failedAttempts ? ` (${u.failedAttempts} failed sign-ins)` : ""),
      );
    }
    return;
  }

  const email = values.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("Give --email name@example.com");

  if (command === "add") {
    const role = values.role as PortalRole | undefined;
    if (!role || !ROLES.includes(role)) fail(`Give --role, one of: ${ROLES.join(", ")}`);
    const partners = new PartnerDirectory(config.PARTNER_API_KEYS, config.PARTNER_WEBHOOK_URLS);
    const partner = values.partner;
    if (role === "operator" && partner) fail("Operators are MOHAR staff: leave out --partner");
    if (role !== "operator") {
      if (!partner) fail("Give --partner, the partner's slug (e.g. demo-bank)");
      if (!partners.get(partner)) {
        fail(
          `No partner "${partner}" in PARTNER_API_KEYS (known: ${partners
            .all()
            .map((p) => p.slug)
            .join(", ")})`,
        );
      }
    }
    if (store.findUserByEmail(email)) fail(`${email} already exists`);

    const password = newPassword(email);
    const totpSecret = newTotpSecret();
    store.saveUser({
      id: newId("usr"),
      email,
      ...(partner ? { partnerSlug: partner } : {}),
      role,
      passwordHash: await hashPassword(password),
      totpSecretSealed: sealer.seal(totpSecret),
      status: "active",
      failedAttempts: 0,
      createdAt: new Date().toISOString(),
    });
    audit("user.create", email, partner);
    await showOnce(email, password, totpSecret);
    return;
  }

  const user = store.findUserByEmail(email);
  if (!user) fail(`No portal user ${email}`);

  if (command === "enable") {
    store.updateUser(user.id, { status: "active", failedAttempts: 0 });
    audit("user.enable", email, user.partnerSlug);
    console.log(`${email} can sign in again.`);
  } else if (command === "disable") {
    store.updateUser(user.id, { status: "disabled" });
    store.deleteSessionsOf(user.id);
    audit("user.disable", email, user.partnerSlug);
    console.log(`${email} is disabled and signed out everywhere.`);
  } else {
    const password = newPassword(email);
    const totpSecret = newTotpSecret();
    store.updateUser(user.id, {
      passwordHash: await hashPassword(password),
      totpSecretSealed: sealer.seal(totpSecret),
      status: "active",
      failedAttempts: 0,
      totpLastCounter: undefined,
    });
    store.deleteSessionsOf(user.id);
    audit("user.reset", email, user.partnerSlug);
    await showOnce(email, password, totpSecret);
  }
}

/** 24 random characters (144 bits). Generated, so it never needs typing into this terminal. */
function newPassword(email: string): string {
  for (;;) {
    const candidate = randomBytes(18).toString("base64url");
    if (!passwordProblem(candidate, email)) return candidate;
  }
}

async function showOnce(email: string, password: string, totpSecret: string): Promise<void> {
  // The QR code is what authenticator apps scan: nothing to copy or type, so no key can be
  // mistyped or pasted into the wrong place. It holds the same secret as the setup key.
  const qr = await QRCode.toString(otpauthUri(totpSecret, email), {
    type: "terminal",
    small: true,
    errorCorrectionLevel: "M",
  });
  console.log(`
Shown once. Do these now, then clear this terminal (Ctrl+L) and close it.

  1. Authenticator app: tap +, choose "Other account" (Microsoft) or "Scan a QR code", and
     scan this. If scanning fails, choose "Enter code manually" and paste the setup key.

${qr}
     Setup key: ${totpSecret}

  2. Password manager: save the email and password below (and the setup key, if you want a
     way to set the app up again).

     Email:     ${email}
     Password:  ${password}

  Never paste the setup key, the QR code or the password into chat, email or a document.
`);
}

function apiIsRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: config.HOST, port: config.PORT });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

await main();
