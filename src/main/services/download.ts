import { createWriteStream } from "node:fs";
import { get as httpGet, type IncomingMessage } from "node:http";
import { get as httpsGet } from "node:https";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface DownloadOptions {
  readonly total?: number;
  readonly onProgress?: (received: number, total: number) => void;
  /** Maximum total duration; defaults to one hour. */
  readonly timeoutMs?: number;
  /** Abort when no bytes arrive for this long; defaults to two minutes. */
  readonly idleTimeoutMs?: number;
  /** Shown in the error message when the server rejects the request. */
  readonly label?: string;
}

const MAX_REDIRECTS = 5;

/**
 * Open a download and follow the redirect chain.
 *
 * This deliberately uses Node's `http`/`https` streams instead of `fetch`.
 * Electron ships an older undici build whose parser asserts when a large
 * response body ends while the async iterator has paused it for backpressure
 * (`assert(this.paused)` in `Parser.finish`), which crashes the main process in
 * the middle of a 300 MB core download. `pipeline` over an IncomingMessage is
 * the battle-tested path for this size and handles pause/resume itself.
 */
const openResponse = (url: URL, signal: AbortSignal, redirects = MAX_REDIRECTS): Promise<IncomingMessage> =>
  new Promise((resolve, reject) => {
    const get = url.protocol === "https:" ? httpsGet : httpGet;
    const request = get(
      url,
      { signal, agent: false, headers: { "user-agent": "Maax", connection: "close" } },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location !== undefined) {
          response.resume();
          if (redirects <= 0) {
            reject(new Error(`Too many redirects while downloading ${url.toString()}`));
            return;
          }
          try {
            openResponse(new URL(location, url), signal, redirects - 1).then(resolve, reject);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
          return;
        }
        resolve(response);
      },
    );
    request.on("error", reject);
  });

/** Stream a URL to disk, reporting progress at most five times per second. */
export const downloadFile = async (
  url: string,
  destination: string,
  options: DownloadOptions = {},
): Promise<{ bytes: number; total: number }> => {
  const overall = AbortSignal.timeout(options.timeoutMs ?? 60 * 60 * 1000);
  const idleTimeoutMs = options.idleTimeoutMs ?? 2 * 60 * 1000;
  const stall = new AbortController();
  let stallTimer = setTimeout(() => stall.abort(), idleTimeoutMs);
  const resetStallTimer = (): void => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => stall.abort(), idleTimeoutMs);
  };
  const signal = AbortSignal.any([overall, stall.signal]);
  const stallMessage = (): Error =>
    new Error(`下载超时：服务器在 ${Math.round(idleTimeoutMs / 1000)} 秒内没有返回数据`);
  let response: IncomingMessage;
  try {
    response = await openResponse(new URL(url), signal);
  } catch (error) {
    clearTimeout(stallTimer);
    throw stall.signal.aborted ? stallMessage() : error;
  }
  const status = response.statusCode ?? 0;
  if (status < 200 || status >= 300) {
    clearTimeout(stallTimer);
    response.resume();
    throw new Error(`HTTP ${status} while downloading ${options.label ?? "file"}`);
  }

  const header = response.headers["content-length"];
  const declared = Number(Array.isArray(header) ? header[0] : header) || options.total || 0;
  let received = 0;
  let lastReport = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.byteLength;
      const now = Date.now();
      if (now - lastReport > 200) {
        lastReport = now;
        options.onProgress?.(received, declared);
      }
      resetStallTimer();
      callback(null, chunk);
    },
  });

  try {
    await pipeline(response, counter, createWriteStream(destination));
  } catch (error) {
    throw stall.signal.aborted ? stallMessage() : error;
  } finally {
    clearTimeout(stallTimer);
  }
  if (declared > 0 && received < declared) {
    throw new Error(`下载不完整：收到 ${received} / ${declared} 字节`);
  }
  options.onProgress?.(received, declared || received);
  return { bytes: received, total: declared || received };
};
