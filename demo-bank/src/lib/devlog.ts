import "server-only";

/**
 * What the demo shows in its "Behind the scenes" panel: every SDK call the bank makes to
 * MOHAR, and every webhook MOHAR sends back. Kept in memory on the bank's server.
 */

export interface SdkCall {
  kind: "call";
  id: number;
  at: string;
  method: string;
  path: string;
  status: number | null;
  ms: number;
  request?: unknown;
  response?: unknown;
}

export interface WebhookReceived {
  kind: "webhook";
  id: number;
  at: string;
  type: string;
  verified: boolean;
  transactionId?: string;
  status?: string;
  reason?: string;
}

export type DevLogEntry = SdkCall | WebhookReceived;

const MAX_ENTRIES = 40;

interface DevLogState {
  nextId: number;
  entries: DevLogEntry[];
}

// Survives Next.js dev-server module reloads.
const globalLog = globalThis as typeof globalThis & { __moharDevLog?: DevLogState };
const state: DevLogState = (globalLog.__moharDevLog ??= { nextId: 1, entries: [] });

type NewEntry = Omit<SdkCall, "id"> | Omit<WebhookReceived, "id">;

export function record(entry: NewEntry): void {
  state.entries.unshift({ ...entry, id: state.nextId++ } as DevLogEntry);
  state.entries.length = Math.min(state.entries.length, MAX_ENTRIES);
}

export function entries(): DevLogEntry[] {
  return state.entries;
}

function parse(body: unknown): unknown {
  if (typeof body !== "string") return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/** A fetch that records each request/response pair before handing back the response. */
export const loggingFetch: typeof fetch = async (input, init) => {
  const started = Date.now();
  const url = new URL(input instanceof Request ? input.url : input.toString());
  const base = {
    kind: "call" as const,
    at: new Date().toISOString(),
    method: init?.method ?? "GET",
    path: url.pathname + url.search,
    request: parse(init?.body),
  };
  try {
    const response = await fetch(input, init);
    const text = await response.clone().text();
    record({ ...base, status: response.status, ms: Date.now() - started, response: parse(text) });
    return response;
  } catch (error) {
    record({ ...base, status: null, ms: Date.now() - started, response: String(error) });
    throw error;
  }
};
