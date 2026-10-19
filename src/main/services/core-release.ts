import { Schema } from "effect";
import semver from "semver";

/**
 * MaaCore release metadata from `api.maa.plus` (a GitHub release mirror).
 *
 * A component update is a whole new core version: the release archive carries
 * `libMaaCore.so` **and** the complete `resource/` tree, including the models
 * and templates that the MaaResource overlay cannot update. Installing it never
 * touches the running core — it lands in its own directory and the registry
 * decides which version is active.
 */
export const CoreReleaseSchema = Schema.Struct({
  version: Schema.String,
  details: Schema.Struct({
    published_at: Schema.optional(Schema.String),
    assets: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        size: Schema.Finite,
        browser_download_url: Schema.String,
      }),
    ),
  }),
});
export type CoreRelease = Schema.Schema.Type<typeof CoreReleaseSchema>;

export interface ReleaseAsset {
  readonly name: string;
  readonly size: number;
  readonly url: string;
}

/**
 * Asset suffixes this build can actually host. Windows needs its own library
 * name and archive format in the core host, so it is not listed yet.
 */
export const platformSuffixFor = (platform: string, arch: string): string | undefined => {
  if (platform === "linux" && arch === "x64") return "linux-x86_64";
  if (platform === "linux" && arch === "arm64") return "linux-aarch64";
  return undefined;
};

/** Pick the full core archive; incremental OTA components are not installable here. */
export const pickCoreAsset = (release: CoreRelease, suffix: string): ReleaseAsset | undefined => {
  const asset = release.details.assets.find(
    (item) => item.name.endsWith(`-${suffix}.tar.gz`) && !item.name.includes("Component"),
  );
  return asset === undefined ? undefined : { name: asset.name, size: asset.size, url: asset.browser_download_url };
};

/**
 * Compare a core version string with the published release. An imported core
 * can carry a directory name instead of a version, which always counts as
 * outdated so the user can move to a real release.
 */
export const isNewerCoreVersion = (current: string | undefined, latest: string): boolean => {
  if (current === undefined || current.trim() === "") return true;
  const next = semver.coerce(latest);
  if (next === null) return current.trim() !== latest.trim();
  const previous = semver.coerce(current);
  if (previous === null) return true;
  return semver.lt(previous, next);
};

export const publishedAtOf = (release: CoreRelease): number | undefined => {
  const value = release.details.published_at;
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
