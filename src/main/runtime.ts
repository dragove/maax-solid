import { layer as NodeFileSystemLive } from "@effect/platform-node/NodeFileSystem";
import { Layer, ManagedRuntime } from "effect";
import { ApplicationLive, type Application } from "./services/application";
import { CoreRegistryLive } from "./services/core-registry";
import { CoreInstallerLive } from "./services/core-installer";
import { AppPathsLive } from "./services/paths";
import { CopilotSetupLive } from "./services/copilot-setup";
import { PrtsLibraryLive } from "./services/prts-library";
import { ResourceUpdaterLive } from "./services/resource-updater";
import { SettingsLive } from "./services/settings";
import { WorkspaceLive } from "./services/workspace";
import { EventBus, EventBusLive } from "./events";

/**
 * Layer graph for the Electron main process. Native/Electron APIs stay at the
 * edges; everything below is ordinary Effect code with typed errors.
 *
 * Only the Node services the app actually consumes are provided: the aggregate
 * NodeServices layer also builds child-process, crypto, stdio and terminal
 * services, which cost startup time and bundle size here.
 */
const CoreInstallerWithDeps = CoreInstallerLive.pipe(
  Layer.provideMerge(SettingsLive),
  Layer.provideMerge(CoreRegistryLive),
  Layer.provideMerge(EventBusLive),
  Layer.provideMerge(AppPathsLive),
  Layer.provideMerge(NodeFileSystemLive),
);

const AppLive = ApplicationLive.pipe(
  Layer.provideMerge(CopilotSetupLive),
  Layer.provideMerge(PrtsLibraryLive),
  Layer.provideMerge(ResourceUpdaterLive),
  Layer.provideMerge(SettingsLive),
  Layer.provideMerge(WorkspaceLive),
  Layer.provideMerge(CoreRegistryLive),
  Layer.provideMerge(CoreInstallerWithDeps),
  Layer.provideMerge(EventBusLive),
  Layer.provideMerge(AppPathsLive),
  Layer.provideMerge(NodeFileSystemLive),
);

export type AppRuntime = ManagedRuntime.ManagedRuntime<Application | EventBus, never>;

export const makeRuntime = (): AppRuntime => ManagedRuntime.make(AppLive);
