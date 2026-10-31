import { join } from "node:path";

/**
 * Native platform facts shared by the core registry, the installer and the
 * MaaCore host. Keeping the file names in one place means a Windows build can
 * never accept a Linux core directory (or vice versa) as "ready".
 */
export const coreLibraryName = (platform: NodeJS.Platform = process.platform): string => {
  if (platform === "win32") return "MaaCore.dll";
  if (platform === "darwin") return "libMaaCore.dylib";
  return "libMaaCore.so";
};

export const coreLibraryPath = (root: string, platform: NodeJS.Platform = process.platform): string =>
  join(root, coreLibraryName(platform));

export const coreResourceConfigPath = (root: string): string => join(root, "resource", "config.json");

export type CoreArchiveKind = "zip" | "tar.gz";

/** MaaCore release archives are `.tar.gz` on Linux and `.zip` on Windows. */
export const coreArchiveKind = (name: string): CoreArchiveKind | undefined => {
  const lower = name.toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "tar.gz";
  if (lower.endsWith(".zip")) return "zip";
  return undefined;
};
