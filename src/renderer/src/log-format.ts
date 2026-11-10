import { callbackRecord as record } from "../../shared/engine";
import type { CoreCallbackEvent, Locale } from "../../shared/schemas";
import { t } from "./i18n/i18n";

/**
 * Display severity of one row. `success` is renderer-only: MaaCore reports the
 * end of a chain through the same callback family either way, and a run that
 * finished should not look identical to one that merely started.
 */
export type LogLevel = "debug" | "info" | "success" | "warn" | "error";

export interface LogLine {
  readonly level: LogLevel;
  readonly message: string;
  /** Context kept out of the clamped row and shown in the detail dialog. */
  readonly detail?: string;
}

export interface UiLogEntry extends LogLine {
  readonly id: number;
  readonly at: number;
  /** Pre-formatted `HH:mm:ss`, so a later locale switch cannot reflow the stream. */
  readonly time: string;
  readonly deviceId?: string;
}

/** Fixed width time column; a locale time string varies in width and digits. */
export function formatLogTime(at: number): string {
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** First line only, for compact surfaces such as the overview activity list. */
export function firstLine(message: string): string {
  return message.split("\n", 1)[0] ?? "";
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const list = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : []);

/** Strip a Windows or POSIX directory from a MaaCore file name. */
const baseName = (value: string): string => value.split(/[\\/]/u).pop() ?? value;

/** Payloads are untrusted JSON, so a star count must stay repeatable. */
const stars = (value: number | undefined): number => Math.min(Math.max(Math.trunc(value ?? 0), 0), 6);

const taskchain = (payload: Record<string, unknown>): string => str(payload.taskchain) || "MaaCore";

const info = (message: string): LogLine => ({ level: "info", message });

/**
 * A stage clear is a multi-line block: the row clamps to three lines and the
 * detail dialog shows the rest. Recognition summaries alone were hiding the
 * item list, which is the only part a player reads.
 */
const stageDrops = (details: Record<string, unknown>, locale: Locale): LogLine => {
  const stage = str(record(details.stage).stageCode) || str(details.stage) || str(details.stage_name);
  const lines = list(details.stats).flatMap((value) => {
    const drop = record(value);
    const name = str(drop.itemName);
    const quantity = num(drop.quantity);
    if (name === "" || quantity === undefined) return [];
    const added = num(drop.addQuantity) ?? 0;
    return [`${name} ×${quantity}${added > 0 ? ` (+${added})` : ""}`];
  });

  const turns = num(details.cur_times);
  if (turns !== undefined && turns > 0) lines.push(`${t(locale, "log.detail.turns")} ${turns}`);

  // Annihilation reports weekly progress as [current, cap] from v6.9.0 on.
  const weekly = list(details.annihilation_weekly_process);
  if (weekly.length === 2) {
    lines.push(`${t(locale, "log.detail.annihilation")} ${String(weekly[0])} / ${String(weekly[1])}`);
  }

  const header = `${t(locale, "log.detail.dropTotal")}${stage === "" ? "" : ` · ${stage}`}`;
  if (lines.length === 0) return info(`${header} · ${t(locale, "log.detail.noDrop")}`);
  return info([header, ...lines].join("\n"));
};

/** 5★ and 6★ are the only results worth a highlight in a wall of recruit rows. */
const recruitResult = (details: Record<string, unknown>, locale: Locale): LogLine => {
  const level = stars(num(details.level));
  const lines = list(details.result).flatMap((value) => {
    const combination = record(value);
    const combinationStars = stars(num(combination.level));
    const tags = list(combination.tags)
      .map((tag) => str(tag))
      .filter((tag) => tag !== "")
      .join("  ");
    const opers = list(combination.opers).flatMap((value) => {
      const oper = record(value);
      const name = str(oper.name);
      if (name === "") return [];
      return [`  ${"★".repeat(stars(num(oper.level)))} ${name}`];
    });
    const head = [combinationStars > 0 ? `${combinationStars}★` : "", tags].filter((part) => part !== "").join("  ");
    return [head, ...opers].filter((line) => line.trim() !== "");
  });

  return {
    level: level >= 5 ? "success" : "info",
    message: `${t(locale, "log.detail.recruit")} · ${level} ★`,
    ...(lines.length > 0 ? { detail: lines.join("\n") } : {}),
  };
};

const operReason = (reason: string, locale: Locale): string => {
  switch (reason) {
    case "Missing":
      return t(locale, "log.copilotOperMissing");
    case "Unchecked":
      return t(locale, "log.copilotOperUnchecked");
    case "Unavailable":
      return t(locale, "log.copilotOperUnavailable");
    default:
      return "";
  }
};

const detailSummary = (what: string, details: Record<string, unknown>, locale: Locale): LogLine => {
  switch (what) {
    case "StageDrops":
      return stageDrops(details, locale);
    case "RecruitResult":
      return recruitResult(details, locale);
    case "SanityBeforeStage": {
      const current = num(details.current);
      const max = num(details.max);
      return info(current !== undefined && max !== undefined ? `理智 ${current}/${max}` : "理智检查");
    }
    case "UseMedicine": {
      const count = num(details.count);
      return info(count !== undefined ? `使用理智药 ×${count}` : "使用理智药");
    }
    case "UseStone":
      return info("使用源石");
    case "FightTimes": {
      const times = num(details.times);
      const max = num(details.max_times);
      return info(times !== undefined && max !== undefined ? `战斗 ${times}/${max}` : "战斗计数");
    }
    case "StageInfo":
      return info(`关卡 ${str(details.name) || str(details.stage) || ""}`.trim());
    case "CopilotListLoadTaskFileSuccess": {
      // `file_name` is what MaaCore sends; `filename` is kept for older builds.
      const file = str(details.file_name) || str(details.filename);
      const stage = str(details.stage_name);
      const index = num(details.id);
      return info(
        [
          t(locale, "log.copilotLoaded"),
          file === "" ? "" : baseName(file),
          stage,
          index === undefined ? "" : `#${index + 1}`,
        ]
          .filter((part) => part !== "")
          .join(" · "),
      );
    }
    case "UnsupportedLevel": {
      const stage = str(details.level);
      return {
        level: "error",
        message: `${t(locale, "log.unsupportedLevel")}${stage === "" ? "" : ` · ${stage}`}`,
      };
    }
    case "BattleFormationOperUnavailable": {
      const name = str(details.oper_name);
      const requirement = str(details.requirement_type);
      return {
        level: "warn",
        message: `${t(locale, "log.formationOperUnavailable")}${name === "" ? "" : ` · ${name}`}${
          requirement === "" ? "" : ` (${requirement})`
        }`,
      };
    }
    case "BattleFormationParseFailed":
      return { level: "error", message: t(locale, "log.formationParseFailed") };
    case "BattleStart":
      return info("进入战斗");
    case "BattleFinished":
      return info("战斗结束");
    case "":
      return info("子任务信息");
    default:
      return info(what);
  }
};

/**
 * Cost fields arrive as numbers or numeric strings depending on the payload
 * (each `FastestWayToScreencap` alternative is stringified, unsupported
 * methods carry "???"), so accept both and treat anything else as unknown.
 */
const costMs = (value: unknown): number | undefined => {
  const ms = typeof value === "string" ? (value.trim() === "" ? Number.NaN : Number(value)) : num(value);
  return ms === undefined || !Number.isFinite(ms) || ms < 0 ? undefined : ms;
};

const timing = (value: unknown): string => {
  const ms = costMs(value);
  return ms === undefined ? "—" : `${ms} ms`;
};

export function formatCoreCallback(event: CoreCallbackEvent, locale: Locale): LogLine {
  const payload = record(event.payload);
  const line = formatCallback(event.msg, payload, locale);
  if (line.level !== "error" && line.level !== "warn") return line;

  // Keep diagnostics bounded and out of the compact row. Retain curated
  // detail (e.g. missing operator groups) ahead of the native payload.
  const limit = 4096;
  const raw = event.raw.length > limit ? `${event.raw.slice(0, limit)}…` : event.raw;
  if (!raw || raw === "{}") return line;
  return {
    ...line,
    detail: [line.detail, `MaaCore · msg ${event.msg}\n${raw}`].filter(Boolean).join("\n\n"),
  };
}

function formatCallback(msg: number, payload: Record<string, unknown>, locale: Locale): LogLine {
  const chain = taskchain(payload);
  const details = record(payload.details);
  const why = str(payload.why);
  const what = str(payload.what);

  const reason = [why, str(details.error), str(details.reason)]
    .filter((value, index, all) => value !== "" && all.indexOf(value) === index)
    .join(" · ");
  const reasonSuffix = reason ? ` · ${reason}` : "";

  if ((msg === 2 || msg === 20003) && what === "ScreencapCost") {
    // A rolling controller statistic, not a per-capture failure: faults stay
    // visible without promoting every ten captures to a warning.
    const faults = num(details.fault_times);
    return {
      level: faults !== undefined && faults > 0 ? "info" : "debug",
      message: [
        t(locale, "log.screencapCost"),
        `${t(locale, "log.screencapAverage")} ${timing(details.avg)}`,
        `${t(locale, "log.screencapRange")} ${timing(details.min)} – ${timing(details.max)}`,
        faults !== undefined && faults > 0 ? `${t(locale, "log.screencapFailures")} ${faults}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }

  switch (msg) {
    case 0:
      return { level: "error", message: `${t(locale, "log.raw")} · InternalError${reasonSuffix}` };
    case 1:
      return { level: "error", message: `InitFailed${reasonSuffix}` };
    case 2: {
      if (what === "FastestWayToScreencap") {
        const alternatives = list(details.alternatives).flatMap((entry) => {
          const alternative = record(entry);
          const method = str(alternative.method);
          return method ? [`${method} · ${timing(alternative.cost)}`] : [];
        });
        return {
          level: "info",
          message: `${t(locale, "log.screencapMethod")} · ${str(details.method) || "—"} · ${timing(details.cost)}`,
          ...(alternatives.length > 0 ? { detail: alternatives.join("\n") } : {}),
        };
      }
      if (what === "EmulatorFPS") {
        const fps = num(details.fps);
        if (fps !== undefined) return { level: "debug", message: `${t(locale, "log.connection")} · ${fps} FPS` };
      }
      return {
        level:
          what === "ScreencapFailed" || what === "ResolutionError"
            ? "error"
            : what === "ConnectFailed" || what === "Disconnect"
              ? "warn"
              : "info",
        message: [t(locale, "log.connection"), what, ...[reason].filter((value) => value !== what)]
          .filter(Boolean)
          .join(" · "),
      };
    }
    case 3:
      // MaaCore emits AllTasksCompleted whenever the queue empties, including
      // after a failed chain. Keep this a neutral marker; the per-chain rows and
      // the run snapshot carry success or failure.
      return { level: "info", message: `${t(locale, "log.allDone")} · ${chain}` };
    case 4: {
      const failed = details.ret === false || reason !== "";
      const capture = what === "Screencap";
      const duration = costMs(details.cost);
      return {
        level: failed ? "error" : capture ? "info" : "debug",
        message: [
          capture ? t(locale, "log.screencapCapture") : t(locale, "log.async"),
          capture ? "" : what,
          duration === undefined ? "" : timing(duration),
          failed ? t(locale, "log.callbackFailed") : "",
          reason,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    }
    case 5:
      return { level: "debug", message: t(locale, "log.instanceDestroyed") };
    case 10000: {
      // MaaCore's TaskChainError carries only the chain (plus an exception code
      // when it caught one). The actionable cause usually arrived earlier as a
      // SubTaskError; when even this payload is empty, name what to check
      // instead of leaving the row at "Task chain error · Copilot".
      const reasons = [why, str(details.task), str(details.error), str(details.reason)].filter(
        (value, index, all) => value !== "" && all.indexOf(value) === index,
      );
      const hint = chain === "Copilot" && reasons.length === 0 ? ` · ${t(locale, "log.copilotChainError")}` : "";
      return {
        level: "error",
        message: `${t(locale, "log.taskError")} · ${chain}${reasons.length === 0 ? "" : ` · ${reasons.join(" · ")}`}${hint}`,
      };
    }
    case 10001:
      return { level: "info", message: `${t(locale, "log.taskStart")} · ${chain}` };
    case 10002:
      return { level: "success", message: `${t(locale, "log.taskDone")} · ${chain}` };
    case 10003:
      return { level: "debug", message: `${chain} · ${what || "extra info"}` };
    case 10004:
      return { level: "warn", message: `${t(locale, "log.taskStopped")} · ${chain}` };
    case 20000: {
      const subtask = str(payload.subtask);
      const first = list(payload.first).filter((value): value is string => typeof value === "string");
      const label = first[0] || str(details.task) || subtask || chain;
      // Structured copilot failures all arrive as one SubTaskError family;
      // without these branches they collapse into a generic subtask line and
      // the reason never reaches the log.
      if (what === "CopilotFileReadError") {
        return { level: "error", message: `${chain} · ${t(locale, "log.copilotFileReadError")}` };
      }
      if (what === "CopilotStageNotSupported") {
        const stage = str(details.stage_name);
        return {
          level: "error",
          message: `${chain} · ${t(locale, "log.copilotStageUnsupported")}${stage === "" ? "" : ` · ${stage}`}`,
        };
      }
      if (what === "UserAdditionalOperInvalid") {
        const name = str(details.name);
        return {
          level: "error",
          message: `${chain} · ${t(locale, "log.copilotUserAdditionalInvalid")}${name === "" ? "" : ` · ${name}`}`,
        };
      }
      if (what === "OperboxDataParseFailed") {
        return { level: "error", message: `${chain} · ${t(locale, "log.copilotOperboxParseFailed")}` };
      }
      if (subtask === "BattleFormationTask" && why === "OperatorMissing") {
        const groups = record(details.opers);
        const lines: string[] = [];
        for (const [group, value] of Object.entries(groups)) {
          const opers = list(value).flatMap((item) => {
            const oper = record(item);
            const name = str(oper.name);
            if (name === "") return [];
            const reason = operReason(str(oper.reason), locale);
            return [{ name, text: reason === "" ? name : `${name} (${reason})` }];
          });
          if (opers.length === 0) continue;
          // A one-operator group is usually named after that operator; keep the
          // reason without repeating the name. Otherwise show the group mapping.
          lines.push(
            opers.length === 1 && opers[0]!.name === group
              ? opers[0]!.text
              : `${group} ⇒ ${opers.map((oper) => oper.text).join(" / ")}`,
          );
        }
        return {
          level: "error",
          message: `${chain} · ${t(locale, "log.copilotMissingOperators")}`,
          ...(lines.length === 0 ? {} : { detail: lines.join("\n") }),
        };
      }
      if (subtask === "AutoRecruitTask") {
        return {
          level: "error",
          message: `${t(locale, "log.recruitError")}${why ? ` · ${why}` : ""}`,
        };
      }
      if (subtask === "RecognizeDrops") {
        return { level: "error", message: t(locale, "log.dropError") };
      }
      if (subtask === "StartGameTask") {
        return { level: "error", message: t(locale, "log.startGameError") };
      }
      if (subtask === "StopGameTask") {
        return { level: "error", message: t(locale, "log.stopGameError") };
      }
      if (subtask === "DepotRecognitionTask" && str(payload.what) === "DepotTemplateLoadError") {
        return { level: "error", message: t(locale, "log.depotError") };
      }

      // ProcessTask emits SubTaskError for ordinary recognition misses and
      // expected branch exits. Keep them for diagnostics, not as warnings.
      return {
        level: "debug",
        message: `${t(locale, "log.subtask")} · ${label} · ${t(locale, "log.callbackFailed")}${reasonSuffix}`,
      };
    }
    case 20001:
      return {
        level: "debug",
        message: `${t(locale, "log.subtask")} · ${str(details.task) || what || str(payload.subtask) || chain} · start`,
      };
    case 20002:
      return {
        level: "debug",
        message: `${t(locale, "log.subtask")} · ${str(details.task) || what || str(payload.subtask) || chain} · done`,
      };
    case 20003: {
      if (what === "ExceededLimit") {
        const task = str(details.task);
        const first = list(payload.first).filter((value): value is string => typeof value === "string");
        const stageNavigation =
          task === "FullStageNavigation" || first.some((value) => value.includes("FullStageNavigation"));
        return {
          level: "warn",
          message: stageNavigation
            ? `${chain} · ${t(locale, "log.copilotNavigation")}`
            : `${chain} · ${task || what} · exceeded limit`,
        };
      }
      const summary = detailSummary(what, details, locale);
      return {
        level: summary.level,
        message: `${chain} · ${summary.message}`,
        ...(summary.detail === undefined ? {} : { detail: summary.detail }),
      };
    }
    case 20004:
      return { level: "warn", message: `${t(locale, "log.subtask")} · ${chain} · stopped` };
    case 30000:
      return { level: "debug", message: `ReportRequest${what ? ` · ${what}` : ""}` };
    default:
      return { level: "debug", message: `MaaCore · msg ${msg}` };
  }
}
