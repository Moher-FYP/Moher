import "server-only";
import { MoharClient } from "@mohar/sdk";

let client: MoharClient | undefined;

/**
 * The bank's MOHAR client. Server-only: the API key lives in server env vars and never reaches
 * the browser. Pages call this from Server Components, Server Actions or Route Handlers —
 * exactly how a real partner bank would integrate.
 */
export function getMohar(): MoharClient {
  client ??= new MoharClient({
    apiKey: process.env.MOHAR_API_KEY ?? "mk_test_local",
    baseUrl: process.env.MOHAR_API_URL ?? "http://localhost:4000",
  });
  return client;
}
