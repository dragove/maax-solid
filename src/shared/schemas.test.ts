import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { AppSettingsSchema, CopilotSetupSchema, DEFAULT_COPILOT_OPTIONS, DEFAULT_SETTINGS } from "./schemas";

describe("copilot setup schema", () => {
  const item = { id: "a", copilotId: 1, filename: "/tmp/a.json", stage: "1-7", title: "t" };

  it("reads an assignment saved before the per-item switch existed", () => {
    const decoded = Schema.decodeSync(CopilotSetupSchema)({
      items: [{ ...item, isRaid: false }],
      options: DEFAULT_COPILOT_OPTIONS,
    });
    expect(decoded.items[0]?.modes).toBeUndefined();
  });

  it("keeps an explicitly switched-off assignment off", () => {
    const decoded = Schema.decodeSync(CopilotSetupSchema)({
      items: [{ ...item, enabled: false }],
      options: DEFAULT_COPILOT_OPTIONS,
    });
    expect(decoded.items[0]?.enabled).toBe(false);
  });

  it("decodes the per-row difficulty checkboxes", () => {
    const decoded = Schema.decodeSync(CopilotSetupSchema)({
      items: [{ ...item, modes: { normal: true, raid: true } }],
      options: DEFAULT_COPILOT_OPTIONS,
    });
    expect(decoded.items[0]?.modes).toEqual({ normal: true, raid: true });
  });
});

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
