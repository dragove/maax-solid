import { BrowserWindow, dialog, ipcMain } from "electron";
import { Effect, Schema } from "effect";
import { AppSettingsPatchSchema, DeviceDraftSchema, DeviceUpdateSchema, TaskPlanSchema } from "../shared/schemas";
import { COMMANDS, IPC_CHANNELS } from "../shared/ipc";
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
      case COMMANDS.bootstrap:
        return run((app) => app.bootstrap);
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
      case COMMANDS.startRun: {
        const { deviceId, planId } = decode(RunInputSchema, payload);
        return run((app) => app.startRun(deviceId, planId));
      }
      case COMMANDS.stopRun: {
        const { deviceId } = decode(Schema.Struct({ deviceId: Schema.String }), payload);
        return run((app) => app.stopRun(deviceId));
      }
      default:
        return {
          ok: false,
          error: { tag: "UnknownCommand", message: `Unknown command: ${command}` },
        };
    }
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
