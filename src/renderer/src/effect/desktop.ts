import { Context, Effect, Layer, Schema } from "effect";
import type { CommandName, CommandPayloads, CommandResults, MaaxBridge } from "../../../shared/ipc";
import { COMMANDS } from "../../../shared/ipc";
import {
  AppSettingsSchema,
  BootstrapSchema,
  CopilotFileSchema,
  CopilotSetupSchema,
  CopilotLevelSchema,
  CopilotResolveResultSchema,
  CopilotSearchResultSchema,
  CoreInfoSchema,
  CoreReleaseCheckSchema,
  DeviceViewSchema,
  IpcEnvelopeSchema,
  MaaxEventSchema,
  OperatorEntrySchema,
  RecruitmentDataSchema,
  RunHistorySchema,
  ScheduleSchema,
  ResourceApplyResultSchema,
  ResourceCheckSchema,
  ResourceStatusSchema,
  RunSnapshotSchema,
  ScreenshotSchema,
  StageCatalogSchema,
  TaskPlanSchema,
  type MaaxEvent,
} from "../../../shared/schemas";

/**
 * Typed, schema-validated access to the sandboxed preload bridge.
 *
 * The renderer never calls `window.maax` directly. Commands are exposed as
 * Effects so callers can compose retries, timeouts and interruption, and every
 * response is decoded before it reaches application state.
 */
export class DesktopBridge extends Context.Service<
  DesktopBridge,
  {
    readonly invoke: (command: string, payload: unknown) => Promise<unknown>;
  }
>()("maax/DesktopBridge") {}

export class DesktopBridgeError extends Schema.TaggedError<DesktopBridgeError, { readonly brand: unique symbol }>()(
  "DesktopBridgeError",
  {
    operation: Schema.String,
    reason: Schema.String,
  },
) {}

function getBridge(): MaaxBridge {
  if (!window.maax) {
    throw new Error("The secure preload bridge is unavailable.");
  }
  return window.maax;
}

const resultSchemas = {
  [COMMANDS.bootstrap]: BootstrapSchema,
  [COMMANDS.updateSettings]: AppSettingsSchema,
  [COMMANDS.pickAndAddCore]: Schema.NullOr(CoreInfoSchema),
  [COMMANDS.addCore]: CoreInfoSchema,
  [COMMANDS.setActiveCore]: Schema.Struct({
    settings: AppSettingsSchema,
    cores: Schema.Array(CoreInfoSchema),
  }),
  [COMMANDS.removeCore]: Schema.Array(CoreInfoSchema),
  [COMMANDS.refreshCores]: Schema.Array(CoreInfoSchema),
  [COMMANDS.downloadCore]: Schema.NullOr(CoreInfoSchema),
  [COMMANDS.checkCoreUpdate]: CoreReleaseCheckSchema,
  [COMMANDS.repairCore]: Schema.Array(CoreInfoSchema),
  [COMMANDS.moveCore]: Schema.Array(CoreInfoSchema),
  [COMMANDS.resourceStatus]: ResourceStatusSchema,
  [COMMANDS.checkResourceUpdate]: ResourceCheckSchema,
  [COMMANDS.updateResource]: ResourceApplyResultSchema,
  [COMMANDS.rollbackResource]: ResourceApplyResultSchema,
  [COMMANDS.stageCatalog]: StageCatalogSchema,
  [COMMANDS.addDevice]: DeviceViewSchema,
  [COMMANDS.updateDevice]: DeviceViewSchema,
  [COMMANDS.removeDevice]: Schema.Array(DeviceViewSchema),
  [COMMANDS.connectDevice]: DeviceViewSchema,
  [COMMANDS.disconnectDevice]: DeviceViewSchema,
  [COMMANDS.screenshotDevice]: ScreenshotSchema,
  [COMMANDS.savePlan]: TaskPlanSchema,
  [COMMANDS.removePlan]: Schema.Array(TaskPlanSchema),
  [COMMANDS.createPlan]: TaskPlanSchema,
  [COMMANDS.duplicatePlan]: TaskPlanSchema,
  [COMMANDS.renamePlan]: TaskPlanSchema,
  [COMMANDS.importPlan]: Schema.NullOr(TaskPlanSchema),
  [COMMANDS.exportPlan]: Schema.NullOr(Schema.String),
  [COMMANDS.setActivePlan]: DeviceViewSchema,
  [COMMANDS.importCopilot]: Schema.NullOr(CopilotFileSchema),
  [COMMANDS.pickVideo]: Schema.NullOr(Schema.String),
  [COMMANDS.resolveCopilot]: CopilotResolveResultSchema,
  [COMMANDS.searchCopilot]: CopilotSearchResultSchema,
  [COMMANDS.searchCopilotLevels]: Schema.Array(CopilotLevelSchema),
  [COMMANDS.searchOperators]: Schema.Array(OperatorEntrySchema),
  [COMMANDS.updateCopilotOptions]: CopilotSetupSchema,
  [COMMANDS.setCopilotItems]: CopilotSetupSchema,
  [COMMANDS.startCopilot]: RunSnapshotSchema,
  [COMMANDS.startRun]: RunSnapshotSchema,
  [COMMANDS.stopRun]: RunSnapshotSchema,
  [COMMANDS.runHistory]: RunHistorySchema,
  [COMMANDS.clearHistory]: RunHistorySchema,
  [COMMANDS.saveSchedule]: Schema.Array(ScheduleSchema),
  [COMMANDS.recruitmentData]: RecruitmentDataSchema,
  [COMMANDS.startTool]: RunSnapshotSchema,
  [COMMANDS.exportLogs]: Schema.NullOr(Schema.String),
  [COMMANDS.exportDiagnostics]: Schema.NullOr(Schema.String),
} as const;

export function command<C extends CommandName>(
  name: C,
  payload: CommandPayloads[C],
): Effect.Effect<CommandResults[C], DesktopBridgeError, DesktopBridge> {
  return Effect.gen(function* () {
    const bridge = yield* DesktopBridge;
    const raw = yield* Effect.tryPromise({
      try: () => bridge.invoke(name, payload),
      catch: (cause) =>
        new DesktopBridgeError({
          operation: name,
          reason: cause instanceof Error ? cause.message : String(cause),
        }),
    });

    const envelope = yield* Schema.decodeUnknownEffect(IpcEnvelopeSchema)(raw).pipe(
      Effect.mapError((cause) => new DesktopBridgeError({ operation: `${name}/envelope`, reason: cause.message })),
    );

    if (!envelope.ok) {
      return yield* new DesktopBridgeError({
        operation: envelope.error.tag,
        reason: envelope.error.detail ? `${envelope.error.message} (${envelope.error.detail})` : envelope.error.message,
      });
    }

    const value = yield* Schema.decodeUnknownEffect(
      resultSchemas[name] as unknown as Schema.ConstraintDecoder<unknown>,
    )(envelope.value).pipe(
      Effect.mapError((cause) => new DesktopBridgeError({ operation: `${name}/result`, reason: cause.message })),
    );
    return value as CommandResults[C];
  });
}

export const bootstrap = command(COMMANDS.bootstrap, undefined);

export const DesktopBridgeLive = Layer.succeed(DesktopBridge, {
  invoke: (commandName, payload) => getBridge().invoke(commandName, payload),
});

/** Subscribe to validated main-process events. Returns an unsubscribe function. */
export function subscribeEvents(listener: (event: MaaxEvent) => void): () => void {
  return getBridge().subscribe((raw) => {
    try {
      listener(Schema.decodeUnknownSync(MaaxEventSchema)(raw));
    } catch (error) {
      console.error("Dropped invalid renderer event", error);
    }
  });
}
