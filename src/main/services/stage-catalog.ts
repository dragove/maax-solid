import { Effect, Schema } from "effect";
import type { StageCatalogEntry } from "../../shared/schemas";
import { maaxError, type MaaxError } from "../errors";

export const STAGE_ACTIVITY_URL = "https://api.maa.plus/MaaAssistantArknights/api/gui/StageActivityV2.json";

const ActivityInfoSchema = Schema.Struct({
  Tip: Schema.optional(Schema.String),
  StageName: Schema.optional(Schema.String),
  UtcStartTime: Schema.optional(Schema.String),
  UtcExpireTime: Schema.optional(Schema.String),
  TimeZone: Schema.optional(Schema.Finite),
});
const ActivityStageSchema = Schema.Struct({
  Display: Schema.optional(Schema.String),
  Value: Schema.optional(Schema.String),
  Drop: Schema.optional(Schema.String),
});
const SideStorySchema = Schema.Struct({
  MinimumRequired: Schema.optional(Schema.String),
  Activity: Schema.optional(ActivityInfoSchema),
  Stages: Schema.optional(Schema.Array(ActivityStageSchema)),
});
export const StageActivityResponseSchema = Schema.Record(
  Schema.String,
  Schema.Struct({ sideStoryStage: Schema.optional(Schema.Record(Schema.String, SideStorySchema)) }),
);
export type StageActivityData = Schema.Schema.Type<typeof StageActivityResponseSchema>;

export const parseActivityDate = (value: string | undefined, timeZone: number | undefined): number => {
  if (!value) return 0;
  const normalized = value.replaceAll("/", "-").replace(" ", "T");
  const zone = typeof timeZone === "number" ? timeZone : 8;
  const offset = `${zone >= 0 ? "+" : "-"}${String(Math.abs(zone)).padStart(2, "0")}:00`;
  const parsed = Date.parse(`${normalized}${offset}`);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const permanentStageEntries = (locale: string): ReadonlyArray<StageCatalogEntry> => {
  const zh = locale === "zh-CN";
  const group = {
    recommended: zh ? "推荐" : "Recommended",
    resource: zh ? "资源关卡" : "Resource stages",
    annihilation: zh ? "剿灭作战" : "Annihilation",
  };
  const entry = (value: string, label: string, groupLabel: string, tip?: string): StageCatalogEntry => ({
    value,
    label,
    group: groupLabel,
    groupLabel,
    ...(tip ? { tip } : {}),
  });

  return [
    entry(
      "",
      zh ? "当前 / 上次关卡" : "Current / last stage",
      group.recommended,
      zh ? "留空则识别游戏当前或上次关卡" : "Leave empty to use the current or last stage",
    ),
    entry("1-7", "1-7", group.recommended),
    entry("R8-11", "R8-11", group.recommended),
    entry("12-17-HARD", "12-17-HARD", group.recommended),
    entry("CE-6", "CE-6", group.resource, zh ? "龙门币" : "LMD"),
    entry("LS-6", "LS-6", group.resource, zh ? "经验" : "EXP"),
    entry("CA-5", "CA-5", group.resource, zh ? "技能" : "Skill summaries"),
    entry("AP-5", "AP-5", group.resource, zh ? "采购凭证" : "Purchase certificates"),
    entry("SK-5", "SK-5", group.resource, zh ? "碳" : "Carbon"),
    entry("PR-A-1", "PR-A-1", group.resource, zh ? "术师/近卫芯片" : "Caster/Guard chips"),
    entry("PR-A-2", "PR-A-2", group.resource, zh ? "术师/近卫芯片" : "Caster/Guard chips"),
    entry("PR-B-1", "PR-B-1", group.resource, zh ? "狙击/重装芯片" : "Sniper/Defender chips"),
    entry("PR-B-2", "PR-B-2", group.resource, zh ? "狙击/重装芯片" : "Sniper/Defender chips"),
    entry("PR-C-1", "PR-C-1", group.resource, zh ? "医疗/辅助芯片" : "Medic/Supporter chips"),
    entry("PR-C-2", "PR-C-2", group.resource, zh ? "医疗/辅助芯片" : "Medic/Supporter chips"),
    entry("PR-D-1", "PR-D-1", group.resource, zh ? "先锋/特种芯片" : "Vanguard/Specialist chips"),
    entry("PR-D-2", "PR-D-2", group.resource, zh ? "先锋/特种芯片" : "Vanguard/Specialist chips"),
    entry("Annihilation", "Annihilation", group.annihilation, zh ? "当前剿灭" : "Current annihilation"),
    entry("Chernobog@Annihilation", "Chernobog", group.annihilation),
    entry("LungmenOutskirts@Annihilation", "Lungmen Outskirts", group.annihilation),
    entry("LungmenDowntown@Annihilation", "Lungmen Downtown", group.annihilation),
  ];
};

/** Bilibili runs the official client, so it shares the official activity list. */
export const clientKeyFor = (clientType: string): string => (clientType === "Bilibili" ? "Official" : clientType);

export const decodeStageActivity = (raw: unknown): Effect.Effect<StageActivityData, MaaxError> =>
  Schema.decodeUnknownEffect(StageActivityResponseSchema)(raw).pipe(
    Effect.mapError((cause) => maaxError("活动关卡数据格式无效", cause)),
  );

export interface StageActivityResult {
  readonly entries: ReadonlyArray<StageCatalogEntry>;
  readonly warning?: string;
}

/**
 * Turn one client's activity response into stage entries, keeping only the
 * windows that are open at `now`. Missing or unparsable dates are treated as
 * unbounded so a malformed schedule never hides a live stage.
 */
export const activityStageEntries = (
  data: StageActivityData,
  client: string,
  locale: string,
  now: number,
): ReadonlyArray<StageCatalogEntry> => {
  const zh = locale === "zh-CN";
  const entries: StageCatalogEntry[] = [];
  for (const story of Object.values(data[client]?.sideStoryStage ?? {})) {
    const info = story.Activity;
    const start = parseActivityDate(info?.UtcStartTime, info?.TimeZone);
    const expire = parseActivityDate(info?.UtcExpireTime, info?.TimeZone);
    if (start > 0 && now < start) continue;
    if (expire > 0 && now > expire) continue;
    const groupLabel = `${zh ? "活动" : "Event"} · ${info?.StageName || info?.Tip || ""}`.trim();
    for (const stage of story.Stages ?? []) {
      if (!stage.Value) continue;
      entries.push({
        value: stage.Value,
        label: stage.Display || stage.Value,
        group: "activity",
        groupLabel,
        ...(stage.Drop ? { tip: `${zh ? "掉落" : "Drop"}: ${stage.Drop}` } : {}),
      });
    }
  }
  return entries;
};
