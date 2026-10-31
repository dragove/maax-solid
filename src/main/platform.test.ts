import { describe, expect, it } from "vitest";
import { coreArchiveKind, coreLibraryName } from "./platform";

describe("platform core files", () => {
  it("uses the native library name of the host platform", () => {
    expect(coreLibraryName("win32")).toBe("MaaCore.dll");
    expect(coreLibraryName("linux")).toBe("libMaaCore.so");
    expect(coreLibraryName("darwin")).toBe("libMaaCore.dylib");
  });

  it("recognizes both release archive formats", () => {
    expect(coreArchiveKind("MAA-v6.20.1-win-x64.zip")).toBe("zip");
    expect(coreArchiveKind("MAA-v6.20.1-linux-x86_64.tar.gz")).toBe("tar.gz");
    expect(coreArchiveKind("MAA-v6.20.1-linux-x86_64.AppImage")).toBeUndefined();
  });
});
