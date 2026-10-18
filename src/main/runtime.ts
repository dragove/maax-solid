import { layer as NodeServicesLive } from "@effect/platform-node/NodeServices";
import { Layer, ManagedRuntime } from "effect";
import { ApplicationLive, type Application } from "./services/application";
import { CoreRegistryLive } from "./services/core-registry";
import { CoreInstallerLive } from "./services/core-installer";
import { AppPathsLive } from "./services/paths";
import { SettingsLive } from "./services/settings";
import { WorkspaceLive } from "./services/workspace";
import { EventBus, EventBusLive } from "./events";

/**
 * Layer graph for the Electron main process. Native/Electron APIs stay at the
 * edges; everything below is ordinary Effect code with typed errors.
 */
const CoreInstallerWithDeps = CoreInstallerLive.pipe(
  Layer.provideMerge(SettingsLive),
  Layer.provideMerge(CoreRegistryLive),
  Layer.provideMerge(EventBusLive),
  Layer.provideMerge(AppPathsLive),
  Layer.provideMerge(NodeServicesLive),
);

const AppLive = ApplicationLive.pipe(
  Layer.provideMerge(SettingsLive),
  Layer.provideMerge(WorkspaceLive),
  Layer.provideMerge(CoreRegistryLive),
  Layer.provideMerge(CoreInstallerWithDeps),
  Layer.provideMerge(EventBusLive),
  Layer.provideMerge(AppPathsLive),
  Layer.provideMerge(NodeServicesLive),
);

export type AppRuntime = ManagedRuntime.ManagedRuntime<Application | EventBus, never>;

export const makeRuntime = (): AppRuntime => ManagedRuntime.make(AppLive);
