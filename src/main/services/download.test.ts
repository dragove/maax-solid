import { layer as NodeFileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import { layerNodeHttp } from "@effect/platform-node/NodeHttpClient";
import { Effect, Layer } from "effect";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MaaxError } from "../errors";
import { Downloader, DownloaderLive, type DownloadOptions, type DownloadResult } from "./download";

const servers: Server[] = [];

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
    servers.push(server);
  });

/** The node:http backend is the one production uses; fetch would hide the stream contract. */
const TestLive = DownloaderLive.pipe(Layer.provide(layerNodeHttp), Layer.provide(NodeFileSystemLayer));

const run = <A>(effect: Effect.Effect<A, MaaxError, Downloader>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLive)));

const download = (
  url: string,
  destination: string,
  options?: DownloadOptions,
): Effect.Effect<DownloadResult, MaaxError, Downloader> =>
  Effect.gen(function* () {
    const downloader = yield* Downloader;
    return yield* downloader.download(url, destination, options);
  });

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("Downloader", () => {
  it("streams the body, follows redirects and reports progress", { timeout: 15_000 }, async () => {
    const payload = Buffer.alloc(256 * 1024, 7);
    const server = createServer((request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(302, { location: "/payload" });
        response.end();
        return;
      }
      if (request.url === "/payload") {
        response.writeHead(200, { "content-length": String(payload.length) });
        response.end(payload);
        return;
      }
      response.writeHead(404);
      response.end();
    });
    const port = await listen(server);
    const directory = await mkdtemp(join(tmpdir(), "maax-download-"));
    const target = join(directory, "payload.bin");
    const progress: number[] = [];

    try {
      const result = await run(
        download(`http://127.0.0.1:${port}/redirect`, target, {
          label: "test",
          onProgress: (received) => progress.push(received),
        }),
      );
      expect(result).toEqual({ bytes: payload.length, total: payload.length });
      expect(await readFile(target)).toEqual(payload);
      expect(progress.at(-1)).toBe(payload.length);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects an HTTP error instead of writing a partial file", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(503);
      response.end("unavailable");
    });
    const port = await listen(server);
    const directory = await mkdtemp(join(tmpdir(), "maax-download-"));
    const target = join(directory, "payload.bin");
    try {
      await expect(run(download(`http://127.0.0.1:${port}/missing`, target, { label: "test" }))).rejects.toThrow(
        "HTTP 503",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a malformed redirect Location instead of hanging", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(302, { location: "http://[" });
      response.end();
    });
    const port = await listen(server);
    const directory = await mkdtemp(join(tmpdir(), "maax-download-"));
    try {
      await expect(
        run(download(`http://127.0.0.1:${port}/bad-redirect`, join(directory, "payload.bin"))),
      ).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("aborts a stalled response instead of hanging forever", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-length": "1024" });
      response.write("partial");
    });
    const port = await listen(server);
    const directory = await mkdtemp(join(tmpdir(), "maax-download-"));
    try {
      await expect(
        run(
          download(`http://127.0.0.1:${port}/stall`, join(directory, "payload.bin"), {
            label: "test",
            idleTimeoutMs: 100,
          }),
        ),
      ).rejects.toThrow("下载超时");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
