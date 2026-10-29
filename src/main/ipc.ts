import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { Effect, Schema } from "effect";
import {
  AppSettingsPatchSchema,
  CopilotItemSchema,
  DeviceDraftSchema,
  DeviceUpdateSchema,
  LogEntrySchema,
  ScheduleSchema,
  TaskPlanSchema,
  ToolKindSchema,
} from "../shared/schemas";
import { COMMANDS, IPC_CHANNELS, WINDOW_ACTIONS } from "../shared/ipc";
import { bootTrace } from "./boot-trace";
import { EventBus } from "./events";
import { describeError, type MaaxError } from "./errors";
import type { AppRuntime } from "./runtime";
import { Application, type ApplicationApi } from "./services/application";

const RootInputSchema = Schema.Struct({ root: Schema.NonEmptyString });
const CoreIdInputSchema = Schema.Struct({ coreId: Schema.NonEmptyString });
const IdInputSchema = Schema.Struct({ id: Schema.NonEmptyString });
const RunInputSchema = Schema.Struct({
  deviceId: Schema.NonEmptyString,
  planId: Schema.NonEmptyString,
});
const CopilotOptionsPatchSchema = Schema.Struct({
  formation: Schema.optional(Schema.Boolean),
  addTrust: Schema.optional(Schema.Boolean),
  ignoreRequirements: Schema.optional(Schema.Boolean),
  useSanityPotion: Schema.optional(Schema.Boolean),
  supportUnitUsage: Schema.optional(Schema.Int),
  loopTimes: Schema.optional(Schema.Int),
  formationIndex: Schema.optional(Schema.Int),
});
const CopilotSearchInputSchema = Schema.Struct({
  document: Schema.optional(Schema.String),
  operator: Schema.optional(Schema.String),
  uploaderId: Schema.optional(Schema.String),
  stage: Schema.optional(Schema.String),
  orderBy: Schema.optional(Schema.Literals(["hot", "views", "upload_time"])),
  desc: Schema.optional(Schema.Boolean),
  page: Schema.optional(Schema.Finite),
  limit: Schema.optional(Schema.Finite),
  language: Schema.optional(Schema.Literals(["zh", "en"])),
});
const CopilotSetSearchInputSchema = Schema.Struct({
  keyword: Schema.optional(Schema.String),
  creatorId: Schema.optional(Schema.String),
  page: Schema.optional(Schema.Finite),
  limit: Schema.optional(Schema.Finite),
});
/** One set can list up to 1000 assignments; asking for more is a bug. */
const CopilotSetItemsInputSchema = Schema.Struct({
  ids: Schema.Array(Schema.Finite).check(Schema.isMaxLength(1000)),
});
const RollbackInputSchema = Schema.Struct({
  coreId: Schema.NonEmptyString,
  backupId: Schema.NonEmptyString,
});
const ScheduleInputSchema = Schema.Struct({ schedule: ScheduleSchema });
const LogEntriesInputSchema = Schema.Struct({ entries: Schema.Array(LogEntrySchema) });
const ToolInputSchema = Schema.Struct({
  deviceId: Schema.NonEmptyString,
  kind: ToolKindSchema,
});
const WindowActionSchema = Schema.Literals(Object.values(WINDOW_ACTIONS));

const decode = <A>(schema: Schema.ConstraintDecoder<A>, input: unknown): A => Schema.decodeUnknownSync(schema)(input);

export function registerIpcHandlers(runtime: AppRuntime, getMainWindow: () => BrowserWindow | null): void {
  const run = async (effect: (app: ApplicationApi) => Effect.Effect<unknown, MaaxError>): Promise<unknown> => {
    try {
      const value = await runtime.runPromise(
        Effect.gen(function* () {
          const app = yield* Application;
          return yield* effect(app);
        }),
      );
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
  };

  ipcMain.handle(IPC_CHANNELS.command, async (_event, command: string, payload: unknown): Promise<unknown> => {
    switch (command) {
      case COMMANDS.bootstrap: {
        bootTrace("bootstrap-start");
        const result = await run((app) => app.bootstrap);
        bootTrace("bootstrap-end");
        return result;
      }
      case COMMANDS.updateSettings: {
        const patch = decode(AppSettingsPatchSchema, payload);
        return run((app) => app.updateSettings(patch));
      }
      case COMMANDS.pickAndAddCore: {
        const window = getMainWindow();
        const result = window
          ? await dialog.showOpenDialog(window, {
              title: "选择 MaaCore 目录",
              buttonLabel: "导入",
              properties: ["openDirectory"],
            })
          : await dialog.showOpenDialog({
              title: "选择 MaaCore 目录",
              buttonLabel: "导入",
              properties: ["openDirectory"],
            });
        if (result.canceled || !result.filePaths[0]) {
          return { ok: true, value: null };
        }
        return run((app) => app.addCore(result.filePaths[0]!));
      }
      case COMMANDS.addCore: {
        const { root } = decode(RootInputSchema, payload);
        return run((app) => app.addCore(root));
      }
      case COMMANDS.setActiveCore: {
        const { coreId } = decode(CoreIdInputSchema, payload);
        return run((app) => app.setActiveCore(coreId));
      }
      case COMMANDS.removeCore: {
        const { coreId } = decode(CoreIdInputSchema, payload);
        return run((app) => app.removeCore(coreId));
      }
      case COMMANDS.refreshCores:
        return run((app) => app.refreshCores);
      case COMMANDS.downloadCore:
        return run((app) => app.downloadCore);
      case COMMANDS.checkCoreUpdate:
        return run((app) => app.checkCoreUpdate);
      case COMMANDS.repairCore: {
        const { coreId } = decode(CoreIdInputSchema, payload);
        return run((app) => app.repairCore(coreId));
      }
      case COMMANDS.moveCore: {
        const { coreId } = decode(CoreIdInputSchema, payload);
        return run((app) => app.moveCore(coreId));
      }
      case COMMANDS.resourceStatus: {
        const { coreId } = decode(CoreIdInputSchema, payload);
        return run((app) => app.resourceStatus(coreId));
      }
      case COMMANDS.checkResourceUpdate: {
        const { coreId } = decode(CoreIdInputSchema, payload);
        return run((app) => app.checkResourceUpdate(coreId));
      }
      case COMMANDS.updateResource: {
        const { coreId } = decode(CoreIdInputSchema, payload);
        return run((app) => app.updateResource(coreId));
      }
      case COMMANDS.rollbackResource: {
        const { coreId, backupId } = decode(RollbackInputSchema, payload);
        return run((app) => app.rollbackResource(coreId, backupId));
      }
      case COMMANDS.stageCatalog:
        return run((app) => app.stageCatalog);
      case COMMANDS.addDevice: {
        const draft = decode(DeviceDraftSchema, payload);
        return run((app) => app.addDevice(draft));
      }
      case COMMANDS.updateDevice: {
        const { id, patch } = decode(DeviceUpdateSchema, payload);
        return run((app) => app.updateDevice(id, patch));
      }
      case COMMANDS.removeDevice: {
        const { id } = decode(IdInputSchema, payload);
        return run((app) => app.removeDevice(id));
      }
      case COMMANDS.connectDevice: {
        const { id } = decode(IdInputSchema, payload);
        return run((app) => app.connectDevice(id));
      }
      case COMMANDS.disconnectDevice: {
        const { id } = decode(IdInputSchema, payload);
        return run((app) => app.disconnectDevice(id));
      }
      case COMMANDS.screenshotDevice: {
        const { id } = decode(IdInputSchema, payload);
        return run((app) => app.screenshotDevice(id));
      }
      case COMMANDS.savePlan: {
        const { plan } = decode(Schema.Struct({ plan: TaskPlanSchema }), payload);
        return run((app) => app.savePlan(plan));
      }
      case COMMANDS.removePlan: {
        const { id } = decode(IdInputSchema, payload);
        return run((app) => app.removePlan(id));
      }
      case COMMANDS.createPlan: {
        const { deviceId, name } = decode(
          Schema.Struct({ deviceId: Schema.NonEmptyString, name: Schema.String }),
          payload,
        );
        return run((app) => app.createPlan(deviceId, name));
      }
      case COMMANDS.duplicatePlan: {
        const { planId, name } = decode(
          Schema.Struct({ planId: Schema.NonEmptyString, name: Schema.optional(Schema.String) }),
          payload,
        );
        return run((app) => app.duplicatePlan(planId, name));
      }
      case COMMANDS.renamePlan: {
        const { planId, name } = decode(Schema.Struct({ planId: Schema.NonEmptyString, name: Schema.String }), payload);
        return run((app) => app.renamePlan(planId, name));
      }
      case COMMANDS.importPlan: {
        const { deviceId } = decode(Schema.Struct({ deviceId: Schema.NonEmptyString }), payload);
        return run((app) => app.importPlan(deviceId));
      }
      case COMMANDS.exportPlan: {
        const { planId } = decode(Schema.Struct({ planId: Schema.NonEmptyString }), payload);
        return run((app) => app.exportPlan(planId));
      }
      case COMMANDS.setActivePlan: {
        const { deviceId, planId } = decode(
          Schema.Struct({ deviceId: Schema.NonEmptyString, planId: Schema.NonEmptyString }),
          payload,
        );
        return run((app) => app.setActivePlan(deviceId, planId));
      }
      case COMMANDS.importCopilot:
        return run((app) => app.importCopilotFile);
      case COMMANDS.pickVideo:
        return run((app) => app.pickVideoFile);
      case COMMANDS.resolveCopilot: {
        const { input } = decode(Schema.Struct({ input: Schema.String }), payload);
        return run((app) => app.resolveCopilot(input));
      }
      case COMMANDS.readCopilotDetail: {
        const { filename } = decode(Schema.Struct({ filename: Schema.NonEmptyString }), payload);
        return run((app) => app.readCopilotDetail(filename));
      }
      case COMMANDS.searchCopilot: {
        const params = decode(CopilotSearchInputSchema, payload);
        return run((app) => app.searchCopilot(params));
      }
      case COMMANDS.searchCopilotSets: {
        const params = decode(CopilotSetSearchInputSchema, payload);
        return run((app) => app.copilotSetSearch(params));
      }
      case COMMANDS.copilotSetItems: {
        const { ids } = decode(CopilotSetItemsInputSchema, payload);
        return run((app) => app.copilotSetItems(ids));
      }
      case COMMANDS.searchCopilotLevels: {
        const { query } = decode(Schema.Struct({ query: Schema.String }), payload);
        return run((app) => app.copilotLevels(query));
      }
      case COMMANDS.updateCopilotOptions: {
        const patch = decode(CopilotOptionsPatchSchema, payload);
        return run((app) => app.updateCopilotOptions(patch));
      }
      case COMMANDS.setCopilotItems: {
        const { items } = decode(Schema.Struct({ items: Schema.Array(CopilotItemSchema) }), payload);
        return run((app) => app.setCopilotItems(items));
      }
      case COMMANDS.startCopilot: {
        const { deviceId, itemId } = decode(
          Schema.Struct({ deviceId: Schema.NonEmptyString, itemId: Schema.optional(Schema.NonEmptyString) }),
          payload,
        );
        return run((app) => app.startCopilot(deviceId, itemId));
      }
      case COMMANDS.searchOperators: {
        const { query } = decode(Schema.Struct({ query: Schema.String }), payload);
        return run((app) => app.copilotOperators(query));
      }
      case COMMANDS.roguelikeOperators: {
        const { theme } = decode(Schema.Struct({ theme: Schema.String }), payload);
        return run((app) => app.roguelikeOperators(theme));
      }
      case COMMANDS.operatorAvatars: {
        const { ids } = decode(Schema.Struct({ ids: Schema.Array(Schema.String) }), payload);
        return run((app) => app.operatorAvatars(ids));
      }
      case COMMANDS.startRun: {
        const { deviceId, planId } = decode(RunInputSchema, payload);
        return run((app) => app.startRun(deviceId, planId));
      }
      case COMMANDS.stopRun: {
        const { deviceId } = decode(Schema.Struct({ deviceId: Schema.String }), payload);
        return run((app) => app.stopRun(deviceId));
      }
      case COMMANDS.runHistory:
        return run((app) => app.runHistory);
      case COMMANDS.clearHistory:
        return run((app) => app.clearHistory);
      case COMMANDS.saveSchedule: {
        const { schedule } = decode(ScheduleInputSchema, payload);
        return run((app) => app.saveSchedule(schedule));
      }
      case COMMANDS.recruitmentData:
        return run((app) => app.recruitmentData);
      case COMMANDS.startTool: {
        const { deviceId, kind } = decode(ToolInputSchema, payload);
        return run((app) => app.startTool(deviceId, kind));
      }
      case COMMANDS.exportLogs: {
        const { entries } = decode(LogEntriesInputSchema, payload);
        return run((app) => app.exportLogs(entries));
      }
      case COMMANDS.exportDiagnostics: {
        const { entries } = decode(LogEntriesInputSchema, payload);
        return run((app) => app.exportDiagnostics(entries));
      }
      default:
        return {
          ok: false,
          error: { tag: "UnknownCommand", message: `Unknown command: ${command}` },
        };
    }
  });

  // Custom title bar (non-macOS): fire-and-forget frame actions plus the
  // maximize-state push, so the restore glyph follows window-manager changes.
  const isWindowAction = Schema.is(WindowActionSchema);
  ipcMain.on(IPC_CHANNELS.window, (_event, action: unknown) => {
    const window = getMainWindow();
    if (!window || !isWindowAction(action)) return;
    switch (action) {
      case WINDOW_ACTIONS.minimize:
        window.minimize();
        break;
      case WINDOW_ACTIONS.toggleMaximize:
        if (window.isMaximized()) window.unmaximize();
        else window.maximize();
        break;
      case WINDOW_ACTIONS.close:
        window.close();
        break;
    }
  });
  ipcMain.handle(IPC_CHANNELS.window, (_event, action: unknown): boolean => {
    if (!isWindowAction(action) || action !== WINDOW_ACTIONS.isMaximized) return false;
    return getMainWindow()?.isMaximized() ?? false;
  });
  app.on("browser-window-created", (_event, created) => {
    const pushState = (): void => {
      if (!created.isDestroyed()) created.webContents.send(IPC_CHANNELS.windowState, created.isMaximized());
    };
    created.on("maximize", pushState);
    created.on("unmaximize", pushState);
  });

  void runtime
    .runPromise(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        bus.on((event) => {
          for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed()) {
              window.webContents.send(IPC_CHANNELS.event, event);
            }
          }
        });
      }),
    )
    .catch((error: unknown) => {
      console.error("Failed to subscribe to application events", error);
    });
}
