import "server-only";
import { MoharClient } from "@mohar/sdk";
import { loggingFetch } from "./devlog";

let client: MoharClient | undefined;

/**
 * The bank's MOHAR client. Server-only: the API key lives in server env vars and never reaches
 * the browser. Pages call this from Server Components, Server Actions or Route Handlers —
 * exactly how a real partner bank would integrate. Calls are recorded for the demo panel.
 */
export function getMohar(): MoharClient {
  client ??= new MoharClient({
    apiKey: process.env.MOHAR_API_KEY ?? "mk_test_local",
    baseUrl: process.env.MOHAR_API_URL ?? "http://localhost:4000",
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
  return process.env.MOHAR_API_URL ?? "http://localhost:4000";
}

export function moharApiKey(): string {
  return process.env.MOHAR_API_KEY ?? "mk_test_local";
}

/**
 * MOHAR's operator key for the demo price controls. It is not the bank's API key: a partner
 * cannot move the price it trades at. A real bank would never hold this; the demo panel does so
 * one screen can show both sides.
 */
export function moharDevKey(): string {
  return process.env.MOHAR_DEV_KEY ?? "mk_dev_local";
}
