import { Context, Effect, Layer, Option, Stream } from "effect";
import { FileSystem } from "effect/FileSystem";
import * as Headers from "effect/http/Headers";
import { followRedirects, HttpClient } from "effect/http/HttpClient";
import { MaaxError, maaxError } from "../errors";

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

export interface DownloadResult {
  readonly bytes: number;
  readonly total: number;
}

export interface DownloaderApi {
  /**
   * Stream a URL to disk, reporting progress at most five times per second.
   *
   * The client behind this must be the Node `http`/`https` backend
   * (`@effect/platform-node/NodeHttpClient`'s `layerNodeHttp`), not
   * `FetchHttpClient`. Electron ships an older undici build whose parser
   * asserts when a large response body ends while the iterator has paused it
   * for backpressure (`assert(this.paused)` in `Parser.finish`), which crashes
   * the main process in the middle of a 300 MB core download.
   */
  readonly download: (
    url: string,
    destination: string,
    options?: DownloadOptions,
  ) => Effect.Effect<DownloadResult, MaaxError>;
}

export class Downloader extends Context.Service<Downloader, DownloaderApi>()("maax/Downloader") {}

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
const PROGRESS_INTERVAL_MS = 200;

/** Keep failures that already explain themselves; wrap transport failures. */
const asFailure =
  (message: string) =>
  (cause: unknown): MaaxError =>
    cause instanceof MaaxError ? cause : maaxError(message, cause);

const declaredLength = (headers: Headers.Headers): number =>
  Number(Option.getOrUndefined(Headers.get(headers, "content-length"))) || 0;

export const DownloaderLive: Layer.Layer<Downloader, never, FileSystem | HttpClient> = Layer.effect(
  Downloader,
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const client = (yield* HttpClient).pipe(followRedirects(MAX_REDIRECTS));

    const download = (
      url: string,
      destination: string,
      options: DownloadOptions = {},
    ): Effect.Effect<DownloadResult, MaaxError> => {
      const label = options.label ?? "file";
      const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      const transfer = Effect.scoped(
        Effect.gen(function* () {
          const response = yield* client
            .get(url, { headers: { "user-agent": "Maax", connection: "close" } })
            .pipe(Effect.mapError(asFailure("无法连接下载服务器")));
          if (response.status < 200 || response.status >= 300) {
            return yield* maaxError(`HTTP ${response.status} while downloading ${label}`);
          }

          const declared = declaredLength(response.headers) || options.total || 0;
          let received = 0;
          let lastReport = 0;
          const report = (force: boolean): void => {
            const now = Date.now();
            if (!force && now - lastReport <= PROGRESS_INTERVAL_MS) return;
            lastReport = now;
            options.onProgress?.(received, declared);
          };

          yield* response.stream.pipe(
            Stream.tap((chunk) =>
              Effect.sync(() => {
                received += chunk.byteLength;
                report(false);
              }),
            ),
            Stream.timeoutOrElse({
              duration: idleTimeoutMs,
              orElse: () =>
                Stream.fail(maaxError(`下载超时：服务器在 ${Math.round(idleTimeoutMs / 1000)} 秒内没有返回数据`)),
            }),
            Stream.run(fs.sink(destination)),
            Effect.mapError(asFailure("写入下载文件失败")),
          );

          if (declared > 0 && received < declared) {
            return yield* maaxError(`下载不完整：收到 ${received} / ${declared} 字节`);
          }
          const total = declared || received;
          options.onProgress?.(received, total);
          return { bytes: received, total };
        }),
      );

      return transfer.pipe(
        Effect.timeoutOrElse({
          duration: timeoutMs,
          orElse: () => Effect.fail(maaxError(`下载超时：超过 ${Math.round(timeoutMs / 60_000)} 分钟仍未完成`)),
        }),
      );
    };

    return { download } satisfies DownloaderApi;
  }),
);
