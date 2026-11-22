import "server-only";
import { MoharClient } from "@mohar/sdk";
import { loggingFetch } from "./devlog";
import { partner } from "./partner";

let client: MoharClient | undefined;

/**
 * The bank's MOHAR client. Server-only: the API key lives in server env vars and never reaches
 * the browser. Pages call this from Server Components, Server Actions or Route Handlers —
 * exactly how a real partner bank would integrate. Calls are recorded for the demo panel.
 */
export function getMohar(): MoharClient {
  client ??= new MoharClient({
    apiKey: moharApiKey(),
    baseUrl: moharApiUrl(),
    fetch: loggingFetch,
  });
  return client;
}

let quietClient: MoharClient | undefined;

/** Same client without logging — for status polling, which would flood the demo panel. */
export function getMoharQuiet(): MoharClient {
  quietClient ??= new MoharClient({ apiKey: moharApiKey(), baseUrl: moharApiUrl() });
  return quietClient;
}

export function moharApiUrl(): string {
  // 127.0.0.1, not localhost: the API listens on IPv4 only (HOST=127.0.0.1), and Node may try
  // ::1 first for "localhost", which fails with ECONNREFUSED.
  return process.env.MOHAR_API_URL ?? "http://127.0.0.1:4000";
}

/** This partner's MOHAR API key. The fallback is the API's public local default. */
export function moharApiKey(): string {
  return process.env.MOHAR_API_KEY ?? partner().localApiKey;
}

/**
 * MOHAR's operator key for the demo price controls. It is not the bank's API key: a partner
 * cannot move the price it trades at. A real bank would never hold this; the demo panel does so
 * one screen can show both sides.
 */
export function moharDevKey(): string {
  return process.env.MOHAR_DEV_KEY ?? "mk_dev_local";
}
