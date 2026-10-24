import { For, Show, type Component } from "solid-js";
import type {
  AppSettingsPatch,
  Bootstrap,
  ClientType,
  CoreInfo,
  CoreReleaseCheck,
  DownloadProgress,
  Locale,
  ResourceStatus,
  Theme,
  TouchMode,
} from "../../../shared/schemas";
import { formatResourceStamp } from "../../../shared/resource-version";
import { t } from "../i18n/i18n";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Segmented } from "../components/ui/Segmented";
import { Switch } from "../components/ui/Switch";

interface SettingsProps {
  readonly data: Bootstrap;
  readonly locale: Locale;
  readonly busy: boolean;
  readonly coreBusy: boolean;
  readonly runActive: boolean;
  readonly onUpdateSettings: (patch: AppSettingsPatch) => void;
  readonly download?: DownloadProgress;
  readonly onImportCore: () => void;
  readonly onDownloadCore: () => void;
  readonly onSetActiveCore: (id: string) => void;
  readonly onRemoveCore: (id: string) => void;
  readonly onRepairCore: (id: string) => void;
  readonly onMoveCore: (id: string) => void;
  readonly onRefreshCores: () => void;
  readonly onExportLogs: () => void;
  readonly onExportDiagnostics: () => void;
  readonly logCount: number;
  readonly coreRelease?: CoreReleaseCheck;
  readonly onCheckCoreUpdate: () => void;
  readonly resourceStatuses: Readonly<Record<string, ResourceStatus>>;
  readonly resourceBusy: boolean;
  readonly onCheckResource: (coreId: string) => void;
  readonly onUpdateResource: (coreId: string) => void;
  readonly onRollbackResource: (coreId: string, backupId: string) => void;
}

const clientTypes: ReadonlyArray<ClientType> = ["Official", "Bilibili", "txwy", "YoStarEN", "YoStarJP", "YoStarKR"];

const touchModes: ReadonlyArray<TouchMode> = ["maatouch", "minitouch", "adb"];
const connectionProfiles = ["General", "MuMuEmulator12", "LDPlayer", "Nox", "XYAZ", "WSA", "Androws"];

const coreStatusLabel = (core: CoreInfo, locale: Locale): string => {
  if (core.status === "ready") return t(locale, "settings.coreReady");
  if (core.status === "broken") return t(locale, "settings.coreBroken");
  return t(locale, "settings.coreMissing");
};

export const Settings: Component<SettingsProps> = (props) => {
  const settings = () => props.data.settings;

  /**
   * Resource files cannot be replaced while a device holds a session on that
   * core (B1). Sessions belong to the active core, so the rule collapses to
   * "active core + any live session". `engine.sessionCount` is the main
   * process's own view, which also covers a device that is still connecting.
   */
  const coreInUse = (): boolean =>
    props.data.engine.sessionCount > 0 ||
    props.data.devices.some(
      (device) => device.status === "online" || device.status === "running" || device.status === "connecting",
    );

  const resourceLocked = (core: CoreInfo, active: boolean): boolean =>
    props.resourceBusy || core.status !== "ready" || (active && coreInUse());

  // Prefer the command result: the registry copy is a cache that can lag
  // behind the files on disk.
  const stampText = (core: CoreInfo): string => {
    const stamp = props.resourceStatuses[core.id]?.stamp ?? core.resourceStamp;
    return stamp === undefined ? t(props.locale, "resource.none") : formatResourceStamp(stamp, props.locale);
  };
  const themeOptions: ReadonlyArray<{
    value: Theme;
    key: "settings.themeDark" | "settings.themeLight" | "settings.themeSystem";
  }> = [
    { value: "dark", key: "settings.themeDark" },
    { value: "light", key: "settings.themeLight" },
    { value: "system", key: "settings.themeSystem" },
  ];

  return (
    <div class="page page--settings">
      <header class="page-head">
        <div>
          <h1>{t(props.locale, "settings.title")}</h1>
          <p class="page-subtitle">{t(props.locale, "settings.subtitle")}</p>
        </div>
      </header>

      <div class="settings-layout">
        <div class="settings-column">
          <section class="settings-card">
            <header class="settings-card-head">
              <span class="settings-icon">
                <Icon name="sparkles" />
              </span>
              <div>
                <h2>{t(props.locale, "settings.appearance")}</h2>
                <p>
                  {t(props.locale, "settings.theme")} · {t(props.locale, "settings.language")}
                </p>
              </div>
            </header>
            <div class="setting-row">
              <span class="setting-label">{t(props.locale, "settings.theme")}</span>
              <Segmented
                value={settings().theme}
                options={themeOptions.map((option) => ({ value: option.value, label: t(props.locale, option.key) }))}
                onChange={(theme) => props.onUpdateSettings({ theme })}
              />
            </div>
            <div class="setting-row">
              <span class="setting-label">{t(props.locale, "settings.language")}</span>
              <Segmented
                value={settings().locale}
                options={[
                  { value: "zh-CN", label: t(props.locale, "settings.zh") },
                  { value: "en-US", label: t(props.locale, "settings.en") },
                ]}
                onChange={(locale) => props.onUpdateSettings({ locale })}
              />
            </div>
          </section>

          <section class="settings-card">
            <header class="settings-card-head">
              <span class="settings-icon">
                <Icon name="server" />
              </span>
              <div>
                <h2>{t(props.locale, "settings.cores")}</h2>
                <p>{t(props.locale, "settings.corePath")}</p>
              </div>
              <div class="settings-head-actions">
                <Button size="sm" variant="ghost" onClick={props.onRefreshCores}>
                  <Icon name="refresh-cw" />
                  {t(props.locale, "settings.refreshCores")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={props.onDownloadCore}
                  disabled={props.busy || props.coreBusy || props.download !== undefined}
                >
                  <Icon name="download" />
                  {t(props.locale, "settings.downloadCore")}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={props.onImportCore}
                  disabled={props.busy || props.coreBusy || props.download !== undefined}
                >
                  <Icon name="folder-open" />
                  {t(props.locale, "settings.importCore")}
                </Button>
              </div>
            </header>
            <Show when={props.coreRelease}>
              {(release) => (
                <div class={["core-release", { "core-release--new": release().available }]}>
                  <Icon name={release().available ? "sparkles" : "check"} />
                  <span>
                    {t(props.locale, release().available ? "settings.coreUpdateAvailable" : "settings.coreUpToDate")}
                  </span>
                  <span class="core-release-meta">
                    {[
                      release().available ? release().latest : release().current,
                      release().publishedAt
                        ? new Intl.DateTimeFormat(props.locale, {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                          }).format(release().publishedAt!)
                        : undefined,
                      release().sizeBytes ? `${Math.ceil(release().sizeBytes! / 1024 / 1024)} MB` : undefined,
                    ]
                      .filter((part): part is string => typeof part === "string" && part !== "")
                      .join(" · ")}
                  </span>
                  <div class="core-release-actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={props.busy || props.coreBusy || props.download !== undefined}
                      onClick={props.onCheckCoreUpdate}
                    >
                      <Icon name="refresh-cw" />
                      {t(props.locale, "settings.checkCoreUpdate")}
                    </Button>
                    <Show when={release().available}>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={props.busy || props.coreBusy || props.download !== undefined}
                        onClick={props.onDownloadCore}
                      >
                        <Icon name="download" />
                        {t(props.locale, "settings.updateCore")}
                      </Button>
                    </Show>
                  </div>
                </div>
              )}
            </Show>
            <Show when={props.runActive}>
              <p class="core-switch-hint">{t(props.locale, "settings.coreSwitchBlocked")}</p>
            </Show>
            <Show
              when={props.data.cores.length > 0}
              fallback={
                <div class="settings-empty">
                  <Icon name="hard-drive" />
                  <div>
                    <strong>{t(props.locale, "settings.noCores")}</strong>
                    <p>{t(props.locale, "settings.noCoresHint")}</p>
                  </div>
                </div>
              }
            >
              <ul class="core-list">
                <For each={props.data.cores}>
                  {(core, index) => {
                    const active = () =>
                      props.data.settings.activeCoreId === core.id ||
                      (!props.data.settings.activeCoreId && props.data.cores[0]?.id === core.id);
                    // The registry is sorted newest first, so a later row is an
                    // older version: switching to it is the core rollback path.
                    const olderThanActive = () => {
                      const activeIndex = props.data.cores.findIndex(
                        (item) =>
                          props.data.settings.activeCoreId === item.id ||
                          (!props.data.settings.activeCoreId && item.id === props.data.cores[0]?.id),
                      );
                      return activeIndex >= 0 && index() > activeIndex;
                    };
                    return (
                      <li class={["core-row", { "core-row--active": active() }]}>
                        <div class="core-row-top">
                          <div class="core-main">
                            <div class="core-title">
                              <strong>{core.version}</strong>
                              <span class="core-channel">{core.channel}</span>
                              <Show when={active()}>
                                <span class="tag">{t(props.locale, "common.active")}</span>
                              </Show>
                            </div>
                            <p class="mono-line">{core.root}</p>
                            <div class="core-meta">
                              <span>{coreStatusLabel(core, props.locale)}</span>
                              <span>{core.source}</span>
                              <span>{core.managed ? "managed" : "external"}</span>
                            </div>
                          </div>
                          <div class="core-actions">
                            <Button
                              size="sm"
                              variant={active() ? "ghost" : "secondary"}
                              disabled={active() || core.status !== "ready" || props.busy || props.runActive}
                              title={props.runActive ? t(props.locale, "settings.coreSwitchBlocked") : undefined}
                              onClick={() => props.onSetActiveCore(core.id)}
                            >
                              {t(props.locale, olderThanActive() ? "settings.rollbackTo" : "settings.setActive")}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={
                                !core.managed ||
                                props.coreBusy ||
                                props.resourceBusy ||
                                (active() && (props.runActive || coreInUse()))
                              }
                              title={
                                !core.managed
                                  ? t(props.locale, "settings.coreRepairUnavailable")
                                  : active() && (props.runActive || coreInUse())
                                    ? t(props.locale, "settings.coreSwitchBlocked")
                                    : t(props.locale, "settings.repairCore")
                              }
                              onClick={() => props.onRepairCore(core.id)}
                            >
                              <Icon name="wrench" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={
                                !core.managed ||
                                props.coreBusy ||
                                props.resourceBusy ||
                                (active() && (props.runActive || coreInUse()))
                              }
                              title={
                                !core.managed
                                  ? t(props.locale, "settings.coreMoveUnavailable")
                                  : active() && (props.runActive || coreInUse())
                                    ? t(props.locale, "settings.coreSwitchBlocked")
                                    : t(props.locale, "settings.moveCore")
                              }
                              onClick={() => props.onMoveCore(core.id)}
                            >
                              <Icon name="folder-open" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={active() && props.runActive}
                              title={
                                active() && props.runActive ? t(props.locale, "settings.coreSwitchBlocked") : undefined
                              }
                              onClick={() => props.onRemoveCore(core.id)}
                            >
                              <Icon name="trash-2" />
                            </Button>
                          </div>
                        </div>
                        <div class="core-resource">
                          <span class="core-resource-stamp">
                            {t(props.locale, "resource.stamp")} · {stampText(core)}
                          </span>
                          <Show when={active() && resourceLocked(core, active()) && !props.resourceBusy}>
                            <span class="core-resource-hint">{t(props.locale, "resource.blocked")}</span>
                          </Show>
                          <div class="core-resource-actions">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={resourceLocked(core, active())}
                              onClick={() => props.onCheckResource(core.id)}
                            >
                              <Icon name="refresh-cw" />
                              {t(props.locale, "resource.check")}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={resourceLocked(core, active())}
                              onClick={() => props.onUpdateResource(core.id)}
                            >
                              <Icon name="download" />
                              {t(props.locale, "resource.update")}
                            </Button>
                            <For each={props.resourceStatuses[core.id]?.backups ?? []}>
                              {(backup) => (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={resourceLocked(core, active())}
                                  title={`${t(props.locale, "resource.backups")} · ${backup.files}`}
                                  onClick={() => props.onRollbackResource(core.id, backup.id)}
                                >
                                  <Icon name="clock" />
                                  {formatResourceStamp(backup.stamp, props.locale)}
                                </Button>
                              )}
                            </For>
                          </div>
                        </div>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </Show>
          </section>

          <section class="settings-card">
            <header class="settings-card-head">
              <span class="settings-icon">
                <Icon name="wifi" />
              </span>
              <div>
                <h2>{t(props.locale, "settings.connection")}</h2>
                <p>{t(props.locale, "settings.adbHint")}</p>
              </div>
            </header>
            <label class="field">
              <span class="field-label">{t(props.locale, "settings.adbPath")}</span>
              <input
                class="input input--mono"
                value={settings().adbPath}
                placeholder="adb"
                onChange={(event) => props.onUpdateSettings({ adbPath: event.currentTarget.value.trim() })}
              />
            </label>
            <div class="form-grid">
              <label class="field">
                <span class="field-label">{t(props.locale, "settings.clientType")}</span>
                <select
                  class="input"
                  value={settings().clientType}
                  onChange={(event) => props.onUpdateSettings({ clientType: event.currentTarget.value as ClientType })}
                >
                  <For each={clientTypes}>
                    {(client) => (
                      <option value={client} selected={client === settings().clientType}>
                        {client}
                      </option>
                    )}
                  </For>
                </select>
              </label>
              <label class="field">
                <span class="field-label">{t(props.locale, "settings.touchMode")}</span>
                <select
                  class="input"
                  value={settings().touchMode}
                  onChange={(event) => props.onUpdateSettings({ touchMode: event.currentTarget.value as TouchMode })}
                >
                  <For each={touchModes}>
                    {(mode) => (
                      <option value={mode} selected={mode === settings().touchMode}>
                        {mode}
                      </option>
                    )}
                  </For>
                </select>
              </label>
            </div>
            <label class="field">
              <span class="field-label">{t(props.locale, "settings.connectionConfig")}</span>
              <select
                class="input"
                value={settings().connectionConfig}
                onChange={(event) => props.onUpdateSettings({ connectionConfig: event.currentTarget.value })}
              >
                <For each={connectionProfiles}>
                  {(profile) => (
                    <option value={profile} selected={profile === settings().connectionConfig}>
                      {profile}
                    </option>
                  )}
                </For>
              </select>
            </label>
          </section>

          <section class="settings-card">
            <header class="settings-card-head">
              <span class="settings-icon">
                <Icon name="sliders" />
              </span>
              <div>
                <h2>{t(props.locale, "settings.behavior")}</h2>
                <p>{t(props.locale, "settings.notifications")}</p>
              </div>
            </header>
            <div class="switch-grid">
              <div class="switch-row">
                <span>{t(props.locale, "settings.notifications")}</span>
                <Switch
                  checked={settings().notifyOnComplete}
                  onChange={(value) => props.onUpdateSettings({ notifyOnComplete: value })}
                />
              </div>
              <div class="switch-row">
                <span>{t(props.locale, "settings.confirmDownload")}</span>
                <Switch
                  checked={settings().confirmBeforeDownload}
                  onChange={(value) => props.onUpdateSettings({ confirmBeforeDownload: value })}
                />
              </div>
              <div class="switch-row">
                <span>{t(props.locale, "settings.developerMode")}</span>
                <Switch
                  checked={settings().developerMode}
                  onChange={(value) => props.onUpdateSettings({ developerMode: value })}
                />
              </div>
              <div class="switch-row">
                <span>{t(props.locale, "settings.closeToTray")}</span>
                <Switch
                  checked={settings().closeToTray}
                  onChange={(value) => props.onUpdateSettings({ closeToTray: value })}
                />
              </div>
            </div>
            <p class="muted">{t(props.locale, "settings.closeToTrayHint")}</p>
          </section>

          <section class="settings-card">
            <header class="settings-card-head">
              <span class="settings-icon">
                <Icon name="terminal" />
              </span>
              <div>
                <h2>{t(props.locale, "settings.diagnostics")}</h2>
                <p>{t(props.locale, "settings.diagnosticsHint")}</p>
              </div>
            </header>
            <p class="muted">
              {props.logCount} {t(props.locale, "tasks.logs")}
            </p>
            <div class="settings-head-actions">
              <Button size="sm" variant="secondary" onClick={props.onExportLogs}>
                <Icon name="download" />
                {t(props.locale, "settings.exportLogs")}
              </Button>
              <Button size="sm" variant="primary" onClick={props.onExportDiagnostics}>
                <Icon name="hard-drive" />
                {t(props.locale, "settings.exportDiagnostics")}
              </Button>
            </div>
          </section>
        </div>

        <aside class="settings-column settings-column--side">
          <section class="settings-card">
            <header class="settings-card-head">
              <span class="settings-icon">
                <Icon name="info" />
              </span>
              <div>
                <h2>{t(props.locale, "settings.about")}</h2>
                <p>{t(props.locale, "settings.aboutText")}</p>
              </div>
            </header>
            <dl class="about-list">
              <div>
                <dt>{t(props.locale, "settings.appVersion")}</dt>
                <dd>{props.data.runtime.app.version}</dd>
              </div>
              <div>
                <dt>{t(props.locale, "settings.electronVersion")}</dt>
                <dd>{props.data.runtime.versions.electron}</dd>
              </div>
              <div>
                <dt>{t(props.locale, "settings.nodeVersion")}</dt>
                <dd>{props.data.runtime.versions.node}</dd>
              </div>
              <div>
                <dt>Solid</dt>
                <dd>{__MAAX_BUILD__.solid}</dd>
              </div>
              <div>
                <dt>Effect</dt>
                <dd>{__MAAX_BUILD__.effect}</dd>
              </div>
            </dl>
            <p class="license-note">AGPL-3.0-or-later · MaaCore is licensed separately under AGPL-3.0.</p>
          </section>

          <section class="settings-card">
            <header class="settings-card-head">
              <span class="settings-icon">
                <Icon name="users" />
              </span>
              <div>
                <h2>{t(props.locale, "settings.credits")}</h2>
                <p>{t(props.locale, "settings.creditsText")}</p>
              </div>
            </header>
            <ul class="credits-list">
              <li>
                <a href="https://github.com/MaaAssistantArknights/MaaX" target="_blank" rel="noreferrer">
                  <span class="credits-name">MaaX</span>
                  <span class="credits-note">{t(props.locale, "settings.creditsMaaX")}</span>
                </a>
              </li>
              <li>
                <a href="https://github.com/Aliothmoon/MAA-Meow" target="_blank" rel="noreferrer">
                  <span class="credits-name">MAA-Meow</span>
                  <span class="credits-note">{t(props.locale, "settings.creditsMaaMeow")}</span>
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/MaaAssistantArknights/MaaAssistantArknights"
                  target="_blank"
                  rel="noreferrer"
                >
                  <span class="credits-name">MaaCore</span>
                  <span class="credits-note">{t(props.locale, "settings.creditsMaaCore")}</span>
                </a>
              </li>
            </ul>
          </section>

          <section class="settings-card">
            <header class="settings-card-head">
              <span class="settings-icon">
                <Icon name="book-open" />
              </span>
              <div>
                <h2>MaaCore</h2>
                <p>{t(props.locale, "settings.corePath")}</p>
              </div>
            </header>
            <p class="muted">
              {props.locale === "en-US"
                ? "Core versions are isolated in helper processes. Switching versions never requires restarting MAAX."
                : "每个核心版本运行在独立的辅助进程中，切换版本不需要重启 MAAX。"}
            </p>
            <div class="panel-meta">
              <span>{props.data.cores.length} versions</span>
              <span>{props.data.engine.sessionCount} sessions</span>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
};
