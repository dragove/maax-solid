import type { CoreCallbackEvent, Locale } from "../../shared/schemas";
import { t } from "./i18n/i18n";

export interface LogLine {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly message: string;
}

export interface UiLogEntry extends LogLine {
  readonly id: number;
  readonly at: number;
  readonly deviceId?: string;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const taskchain = (payload: Record<string, unknown>): string => str(payload.taskchain) || "MaaCore";

const detailSummary = (what: string, details: Record<string, unknown>): string => {
  switch (what) {
    case "StageDrops": {
      const stage = str(details.stage) || str(details.stage_name);
      return `掉落识别${stage ? ` · ${stage}` : ""}`;
    }
    case "RecruitResult":
      return "公开招募结果";
    case "SanityBeforeStage": {
      const current = num(details.current);
      const max = num(details.max);
      return current !== undefined && max !== undefined ? `理智 ${current}/${max}` : "理智检查";
    }
    case "UseMedicine": {
      const count = num(details.count);
      return count !== undefined ? `使用理智药 ×${count}` : "使用理智药";
    }
    case "UseStone":
      return "使用源石";
    case "FightTimes": {
      const times = num(details.times);
      const max = num(details.max_times);
      return times !== undefined && max !== undefined ? `战斗 ${times}/${max}` : "战斗计数";
    }
    case "StageInfo":
      return `关卡 ${str(details.name) || str(details.stage) || ""}`.trim();
    case "CopilotListLoadTaskFileSuccess":
      return `作业已加载 · ${str(details.filename)}`;
    case "BattleStart":
      return "进入战斗";
    case "BattleFinished":
      return "战斗结束";
    case "":
      return "子任务信息";
    default:
      return what;
  }
};

export function formatCoreCallback(event: CoreCallbackEvent, locale: Locale): LogLine | null {
  const payload = event.payload as Record<string, unknown>;
  const chain = taskchain(payload);
  const details = (payload.details ?? {}) as Record<string, unknown>;
  const why = str(payload.why);
  const what = str(payload.what);

  switch (event.msg) {
    case 0:
      return { level: "error", message: `${t(locale, "log.raw")} · InternalError ${why}`.trim() };
    case 1:
      return { level: "error", message: `InitFailed${why ? ` · ${why}` : ""}` };
    case 2:
      return {
        level: what === "ConnectFailed" || what === "Disconnect" ? "warn" : "info",
        message: `${t(locale, "log.connection")} · ${what}${why ? ` · ${why}` : ""}`,
      };
    case 3:
      return { level: "info", message: `${t(locale, "log.allDone")} · ${chain}` };
    case 4:
      return {
        level: "debug",
        message: `${t(locale, "log.async")} · ${what}${details.ret === false ? " · failed" : ""}`,
      };
    case 5:
      return { level: "debug", message: t(locale, "log.instanceDestroyed") };
    case 10000:
      return {
        level: "error",
        message: `${t(locale, "log.taskError")} · ${chain}${why ? ` · ${why}` : str(details.task) ? ` · ${str(details.task)}` : ""}`,
      };
    case 10001:
      return { level: "info", message: `${t(locale, "log.taskStart")} · ${chain}` };
    case 10002:
      return { level: "info", message: `${t(locale, "log.taskDone")} · ${chain}` };
    case 10003:
      return { level: "debug", message: `${chain} · ${what || "extra info"}` };
    case 10004:
      return { level: "warn", message: `${t(locale, "log.taskStopped")} · ${chain}` };
    case 20000:
      return {
        level: "warn",
        message: `${t(locale, "log.subtask")} · ${str(details.task) || str(payload.why) || why || "unknown"} · error`,
      };
    case 20001:
      return {
        level: "debug",
        message: `${t(locale, "log.subtask")} · ${str(details.task) || what} · start`,
      };
    case 20002:
      return {
        level: "debug",
        message: `${t(locale, "log.subtask")} · ${str(details.task) || what} · done`,
      };
    case 20003:
      return {
        level: "info",
        message: `${chain} · ${detailSummary(what, details)}`,
      };
    case 20004:
      return { level: "warn", message: `${t(locale, "log.subtask")} · ${chain} · stopped` };
    case 30000:
      return { level: "debug", message: `ReportRequest${what ? ` · ${what}` : ""}` };
    default:
      return { level: "debug", message: `MaaCore · msg ${event.msg}` };
  }
}
