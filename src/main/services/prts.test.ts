import { describe, expect, it } from "vitest";
import { PrtsClient } from "./prts";

const jsonResponse = (body: unknown, status = 200, etag?: string): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(etag === undefined ? {} : { etag }) },
  });

const withFetch = async (
  handler: (url: string, init?: RequestInit) => Response,
  run: (calls: string[]) => Promise<void>,
): Promise<void> => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
    calls.push(url);
    return handler(url, init);
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
};

describe("prts client", () => {
  it("serialises requests with a minimum gap", async () => {
    let clock = 0;
    const started: number[] = [];
    await withFetch(
      () => {
        started.push(clock);
        return jsonResponse({ ok: true });
      },
      async () => {
        const client = new PrtsClient({ minGapMs: 100, now: () => clock });
        const realSetTimeout = globalThis.setTimeout;
        globalThis.setTimeout = ((fn: () => void, ms: number) => {
          clock += ms;
          fn();
          return 0 as unknown as NodeJS.Timeout;
        }) as unknown as typeof setTimeout;
        try {
          await Promise.all([client.getJson("/a"), client.getJson("/b"), client.getJson("/c")]);
        } finally {
          globalThis.setTimeout = realSetTimeout;
        }
      },
    );
    expect(started[0]).toBe(0);
    expect(started[1]! - started[0]!).toBeGreaterThanOrEqual(100);
    expect(started[2]! - started[1]!).toBeGreaterThanOrEqual(100);
  });

  it("serves a repeated query from memory inside the TTL", async () => {
    let clock = 0;
    await withFetch(
      () => jsonResponse({ value: 1 }),
      async (calls) => {
        const client = new PrtsClient({ cacheTtlMs: 1_000, minGapMs: 0, now: () => clock });
        await client.getJson("/same");
        await client.getJson("/same");
        expect(calls).toHaveLength(1);
        clock = 2_000;
        await client.getJson("/same");
        expect(calls).toHaveLength(2);
      },
    );
  });

  it("keeps the queue alive after a failed request", async () => {
    await withFetch(
      (url) => (url.endsWith("/bad") ? new Response("boom", { status: 500 }) : jsonResponse({ ok: true })),
      async () => {
        const client = new PrtsClient({ minGapMs: 0, cacheTtlMs: 0 });
        await expect(client.getJson("/bad")).rejects.toThrow(/HTTP 500/);
        await expect(client.getJson("/good")).resolves.toEqual({ ok: true });
      },
    );
  });

  it("posts an uncached rating request with a JSON body", async () => {
    let seen: { method?: string; body?: string; contentType?: string } = {};
    await withFetch(
      (_url, init) => {
        const headers = new Headers(init?.headers);
        seen = {
          ...(init?.method === undefined ? {} : { method: init.method }),
          ...(typeof init?.body === "string" ? { body: init.body } : {}),
          ...(headers.get("content-type") === null ? {} : { contentType: headers.get("content-type")! }),
        };
        return jsonResponse({ status_code: 200 });
      },
      async () => {
        const client = new PrtsClient({ minGapMs: 0 });
        await client.postJson("/copilot/rating", { id: 123, rating: "Like" });
      },
    );
    expect(seen.method).toBe("POST");
    expect(seen.contentType).toBe("application/json");
    expect(JSON.parse(seen.body ?? "{}")).toEqual({ id: 123, rating: "Like" });
  });

  it("reports 304 without downloading the body again", async () => {
    await withFetch(
      (_url, init) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("if-none-match")).toBe('W/"abc"');
        return new Response(null, { status: 304 });
      },
      async () => {
        const client = new PrtsClient({ minGapMs: 0 });
        const result = await client.getJsonConditional("/levels", 'W/"abc"');
        expect(result.notModified).toBe(true);
        expect(result.etag).toBe('W/"abc"');
      },
    );
  });
});
