import { describe, expect, it, vi } from "vitest";
import { closeToTray, setShellSync, setWindowBehavior, shellLocale } from "./app-behavior";

describe("window behavior mirror", () => {
  it("notifies the shell only when a mirrored value changes", () => {
    const sync = vi.fn();
    setShellSync(sync);

    setWindowBehavior({ closeToTray: true, locale: "en-US" });
    expect(closeToTray()).toBe(true);
    expect(shellLocale()).toBe("en-US");
    expect(sync).toHaveBeenCalledTimes(1);

    // A refresh that re-reads unchanged settings must not rebuild the tray menu.
    setWindowBehavior({ closeToTray: true, locale: "en-US" });
    expect(sync).toHaveBeenCalledTimes(1);

    setWindowBehavior({ closeToTray: false, locale: "zh-CN" });
    expect(closeToTray()).toBe(false);
    expect(shellLocale()).toBe("zh-CN");
    expect(sync).toHaveBeenCalledTimes(2);
  });
});
