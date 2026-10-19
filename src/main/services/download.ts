import { createWriteStream } from "node:fs";

export interface DownloadOptions {
  readonly total?: number;
  readonly onProgress?: (received: number, total: number) => void;
  readonly timeoutMs?: number;
  /** Shown in the error message when the server rejects the request. */
  readonly label?: string;
}

/** Stream a URL to disk, reporting progress at most five times per second. */
export const downloadFile = async (
  url: string,
  destination: string,
  options: DownloadOptions = {},
): Promise<{ bytes: number; total: number }> => {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(options.timeoutMs ?? 15 * 60 * 1000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} while downloading ${options.label ?? "file"}`);
  }
  const declared = Number(response.headers.get("content-length")) || options.total || 0;
  const output = createWriteStream(destination);
  let received = 0;
  let lastReport = 0;
  try {
    for await (const chunk of response.body) {
      const bytes = chunk as Uint8Array;
      received += bytes.byteLength;
      if (!output.write(bytes)) {
        await new Promise<void>((resolve) => output.once("drain", () => resolve()));
      }
      const now = Date.now();
      if (now - lastReport > 200) {
        lastReport = now;
        options.onProgress?.(received, declared);
      }
    }
    await new Promise<void>((resolve) => {
      output.end(() => resolve());
    });
    options.onProgress?.(received, declared || received);
    return { bytes: received, total: declared || received };
  } catch (error) {
    output.destroy();
    throw error;
  }
};
