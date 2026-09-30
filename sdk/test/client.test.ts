import { describe, expect, it, vi } from "vitest";
import { MoharApiError, MoharClient } from "../src/index.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("MoharClient", () => {
  it("sends the API key and an idempotency key on money-moving calls", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(202, {
        id: "txn_1",
        type: "mint",
        status: "pending",
        walletId: "wal_1",
        grams: "0.60410000",
        createdAt: "2026-10-01T00:00:00Z",
      }),
    );
    const client = new MoharClient({ apiKey: "mk_test_abc", fetch: fetchMock });

    const txn = await client.mint({ quoteId: "qt_1" }, { idempotencyKey: "order-42" });

    expect(txn.status).toBe("pending");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("http://localhost:4000/v1/mints");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer mk_test_abc");
    expect(headers["Idempotency-Key"]).toBe("order-42");
    expect(JSON.parse(init.body as string)).toEqual({ quoteId: "qt_1" });
  });

  it("does not send the API key to public endpoints", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { status: "ok" }));
    const client = new MoharClient({ apiKey: "mk_test_abc", fetch: fetchMock });

    await client.getReserve();

    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("turns API errors into MoharApiError with the error code", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(409, { error: { code: "price_moved", message: "Gold moved 0.8%" } }),
    );
    const client = new MoharClient({ apiKey: "mk_test_abc", fetch: fetchMock });

    const error = await client.burn({ quoteId: "qt_1" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MoharApiError);
    expect((error as MoharApiError).status).toBe(409);
    expect((error as MoharApiError).code).toBe("price_moved");
  });

  it("rejects quotes with both or neither of amountPkr and grams", async () => {
    const fetchMock = vi.fn();
    const client = new MoharClient({ apiKey: "mk_test_abc", fetch: fetchMock });

    await expect(client.createQuote({ walletId: "wal_1", side: "buy" })).rejects.toThrow(
      MoharApiError,
    );
    await expect(
      client.createQuote({ walletId: "wal_1", side: "buy", amountPkr: "1000.00", grams: "1" }),
    ).rejects.toThrow(MoharApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("builds list queries without undefined params", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { data: [] }));
    const client = new MoharClient({
      apiKey: "mk_test_abc",
      baseUrl: "https://api.example.test/",
      fetch: fetchMock,
    });

    await client.listTransactions({ walletId: "wal_1", limit: 10 });

    const [url] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(url.toString()).toBe("https://api.example.test/v1/transactions?walletId=wal_1&limit=10");
  });

  it("waits until a transaction reaches a final status", async () => {
    const statuses = ["pending", "submitted", "confirmed"];
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        id: "txn_1",
        type: "mint",
        status: statuses.shift(),
        walletId: "wal_1",
        grams: "1",
        createdAt: "2026-10-01T00:00:00Z",
      }),
    );
    const client = new MoharClient({ apiKey: "mk_test_abc", fetch: fetchMock });

    const txn = await client.waitForTransaction("txn_1", { intervalMs: 1 });

    expect(txn.status).toBe("confirmed");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
