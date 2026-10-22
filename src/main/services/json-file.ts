import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Atomic JSON persistence for the small stores added after the Effect service
 * boundary was defined. They deliberately use Node fs at the edge instead of
 * adding another exception for Effect 4's unstable `FileSystem` service.
 */
export async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const text = JSON.stringify(value, null, 2);
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, text, "utf8");
  await rename(temp, path);
}
