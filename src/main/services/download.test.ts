import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { downloadFile } from "./download";

const servers: Server[] = [];

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
    servers.push(server);
  });

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("downloadFile", () => {
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
      const result = await downloadFile(`http://127.0.0.1:${port}/redirect`, target, {
        label: "test",
        onProgress: (received) => progress.push(received),
      });
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
      await expect(downloadFile(`http://127.0.0.1:${port}/missing`, target, { label: "test" })).rejects.toThrow(
        "HTTP 503",
      );
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
        downloadFile(`http://127.0.0.1:${port}/stall`, join(directory, "payload.bin"), {
          label: "test",
          idleTimeoutMs: 100,
        }),
      ).rejects.toThrow("下载超时");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
