import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Seals small secrets stored at rest (each user's authenticator secret) with AES-256-GCM under
 * a key derived from PORTAL_SECRET_KEY. Someone who copies the portal's data file without that
 * key cannot generate a user's one-time codes. Format: `v1.<iv>.<tag>.<ciphertext>` in base64url.
 */
export class Sealer {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash("sha256").update(`mohar-portal-seal:${secret}`).digest();
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return ["v1", iv, cipher.getAuthTag(), body].map(toText).join(".");
  }

  open(sealed: string): string {
    const [version, iv, tag, body] = sealed.split(".");
    if (version !== "v1" || !iv || !tag || !body) throw new Error("Not a sealed value");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}

function toText(part: string | Buffer): string {
  return typeof part === "string" ? part : part.toString("base64url");
}
