import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { AppSettingsSchema, DEFAULT_SETTINGS } from "./schemas";

describe("settings schema", () => {
  it("ignores retired keys from an existing settings file", () => {
    const decoded = Schema.decodeUnknownSync(AppSettingsSchema)({ ...DEFAULT_SETTINGS, minimizeToTray: true });
    expect(decoded).toEqual(DEFAULT_SETTINGS);
    expect(Object.keys(decoded)).not.toContain("minimizeToTray");
  });

  it("rejects a value outside the theme literals", () => {
    expect(() => Schema.decodeUnknownSync(AppSettingsSchema)({ ...DEFAULT_SETTINGS, theme: "sepia" })).toThrow();
  });

  it("keeps the optional active core omitted rather than undefined", () => {
    const decoded = Schema.decodeSync(AppSettingsSchema)(DEFAULT_SETTINGS);
    expect(Object.keys(decoded)).not.toContain("activeCoreId");
  });
});
