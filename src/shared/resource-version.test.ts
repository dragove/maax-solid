import { describe, expect, it } from "vitest";
import {
  compareResourceStamps,
  formatResourceStamp,
  isNewerResourceStamp,
  parseResourceStamp,
} from "./resource-version";

describe("resource version stamp", () => {
  it("parses the upstream format as UTC", () => {
    expect(parseResourceStamp("2026-10-16 11:38:15.000")).toBe(Date.UTC(2026, 9, 16, 11, 38, 15, 0));
    expect(parseResourceStamp("2026-10-16T11:38:15.5")).toBe(Date.UTC(2026, 9, 16, 11, 38, 15, 500));
    expect(parseResourceStamp("2026-10-16 11:38:15")).toBe(Date.UTC(2026, 9, 16, 11, 38, 15));
  });

  it("returns undefined for values that are not stamps", () => {
    expect(parseResourceStamp("")).toBeUndefined();
    expect(parseResourceStamp("v6.20.0")).toBeUndefined();
    expect(parseResourceStamp("2026-10-16")).toBeUndefined();
  });

  it("orders by instant, not by string", () => {
    expect(compareResourceStamps("2026-10-16 11:38:15.000", "2026-10-16 11:38:15.000")).toBe(0);
    expect(compareResourceStamps("2026-10-17 00:00:00.000", "2026-10-16 23:59:59.999")).toBe(1);
    expect(compareResourceStamps("2026-10-16 11:38:15", "2026-10-16 11:38:15.001")).toBe(-1);
  });

  it("treats a corrupt stamp as the oldest value", () => {
    expect(compareResourceStamps("garbage", "2026-10-16 11:38:15.000")).toBe(-1);
    expect(compareResourceStamps("2026-10-16 11:38:15.000", "garbage")).toBe(1);
    expect(compareResourceStamps("aaa", "bbb")).toBeLessThan(0);
  });

  it("flags only genuinely newer stamps as updates", () => {
    expect(isNewerResourceStamp("2026-10-20 09:00:00.000", "2026-10-16 11:38:15.000")).toBe(true);
    expect(isNewerResourceStamp("2026-10-16 11:38:15.000", "2026-10-16 11:38:15.000")).toBe(false);
    expect(isNewerResourceStamp("2026-10-16 11:38:15.000", "2026-10-20 09:00:00.000")).toBe(false);
  });

  it("formats in the requested zone and passes junk through", () => {
    const stamp = "2026-10-16 11:38:15.000";
    expect(formatResourceStamp(stamp, "en-US", "UTC")).toContain("10/16/2026");
    expect(formatResourceStamp(stamp, "en-US", "Asia/Shanghai")).toContain("10/16/2026");
    expect(formatResourceStamp(stamp, "en-US", "UTC")).not.toBe(formatResourceStamp(stamp, "en-US", "Asia/Shanghai"));
    expect(formatResourceStamp("nope", "en-US")).toBe("nope");
  });
});
