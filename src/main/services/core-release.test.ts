import { describe, expect, it } from "vitest";
import type { CoreRelease } from "./core-release";
import { isNewerCoreVersion, pickCoreAsset, platformSuffixFor, publishedAtOf } from "./core-release";

const release: CoreRelease = {
  version: "v6.21.0",
  details: {
    published_at: "2026-10-20T11:07:35Z",
    assets: [
      { name: "MAA-v6.21.0-linux-x86_64.AppImage", size: 215, browser_download_url: "https://example/appimage" },
      { name: "MAA-v6.21.0-linux-x86_64.tar.gz", size: 234, browser_download_url: "https://example/linux" },
      { name: "MAA-v6.21.0-win-x64.zip", size: 284, browser_download_url: "https://example/win" },
      { name: "MAAComponent-OTA-v6.20.0_v6.21.0-win-x64.zip", size: 6, browser_download_url: "https://example/ota" },
      { name: "MAA-v6.21.0-linux-aarch64.tar.gz", size: 233, browser_download_url: "https://example/aarch64" },
    ],
  },
};

describe("core release metadata", () => {
  it("maps the platforms this build can host", () => {
    expect(platformSuffixFor("linux", "x64")).toBe("linux-x86_64");
    expect(platformSuffixFor("linux", "arm64")).toBe("linux-aarch64");
    expect(platformSuffixFor("win32", "x64")).toBe("win-x64");
    expect(platformSuffixFor("win32", "arm64")).toBe("win-arm64");
    expect(platformSuffixFor("darwin", "arm64")).toBeUndefined();
  });

  it("picks the full core archive and skips AppImages and OTA components", () => {
    expect(pickCoreAsset(release, "linux-x86_64")).toEqual({
      name: "MAA-v6.21.0-linux-x86_64.tar.gz",
      size: 234,
      url: "https://example/linux",
    });
    expect(pickCoreAsset(release, "linux-aarch64")?.name).toBe("MAA-v6.21.0-linux-aarch64.tar.gz");
    expect(pickCoreAsset(release, "win-x64")).toEqual({
      name: "MAA-v6.21.0-win-x64.zip",
      size: 284,
      url: "https://example/win",
    });
    expect(pickCoreAsset(release, "win-arm64")).toBeUndefined();
  });

  it("orders versions and treats an unparseable installed version as outdated", () => {
    expect(isNewerCoreVersion("v6.20.0", "v6.21.0")).toBe(true);
    expect(isNewerCoreVersion("v6.21.0", "v6.21.0")).toBe(false);
    expect(isNewerCoreVersion("v6.22.0", "v6.21.0")).toBe(false);
    expect(isNewerCoreVersion(undefined, "v6.21.0")).toBe(true);
    expect(isNewerCoreVersion("core", "v6.21.0")).toBe(true);
    expect(isNewerCoreVersion("v6.21.0", "nightly")).toBe(true);
  });

  it("reads the publish time when present", () => {
    expect(publishedAtOf(release)).toBe(Date.parse("2026-10-20T11:07:35Z"));
    expect(publishedAtOf({ version: "v1", details: { assets: [] } })).toBeUndefined();
  });
});
