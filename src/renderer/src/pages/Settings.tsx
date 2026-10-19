import { For, Show, type Component } from "solid-js";
import type {
  AppSettingsPatch,
  Bootstrap,
  ClientType,
  CoreInfo,
  DownloadProgress,
  Locale,
  Theme,
  TouchMode,
} from "../../../shared/schemas";
import { t } from "../i18n/i18n";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Switch } from "../components/ui/Switch";

interface SettingsProps {
  readonly data: Bootstrap;
  readonly locale: Locale;
  readonly busy: boolean;
  readonly onUpdateSettings: (patch: AppSettingsPatch) => void;
  readonly download?: DownloadProgress;
  readonly onImportCore: () => void;
  readonly onDownloadCore: () => void;
  readonly onSetActiveCore: (id: string) => void;
  readonly onRemoveCore: (id: string) => void;
  readonly onRefreshCores: () => void;
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
              <div class="segmented">
                <For each={themeOptions}>
                  {(option) => (
                    <button
                      type="button"
                      class={settings().theme === option.value ? "segmented-item segmented-item--on" : "segmented-item"}
                      onClick={() => props.onUpdateSettings({ theme: option.value })}
                    >
                      {t(props.locale, option.key)}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <div class="setting-row">
              <span class="setting-label">{t(props.locale, "settings.language")}</span>
              <div class="segmented">
                <button
                  type="button"
                  class={settings().locale === "zh-CN" ? "segmented-item segmented-item--on" : "segmented-item"}
                  onClick={() => props.onUpdateSettings({ locale: "zh-CN" })}
                >
                  {t(props.locale, "settings.zh")}
                </button>
                <button
                  type="button"
                  class={settings().locale === "en-US" ? "segmented-item segmented-item--on" : "segmented-item"}
                  onClick={() => props.onUpdateSettings({ locale: "en-US" })}
                >
                  {t(props.locale, "settings.en")}
                </button>
              </div>
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
                  disabled={props.busy || props.download !== undefined}
                >
                  <Icon name="download" />
                  {t(props.locale, "settings.downloadCore")}
                </Button>
                <Button size="sm" variant="primary" onClick={props.onImportCore}>
                  <Icon name="folder-open" />
                  {t(props.locale, "settings.importCore")}
                </Button>
              </div>
            </header>
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
                  {(core) => {
                    const active = () =>
                      props.data.settings.activeCoreId === core.id ||
                      (!props.data.settings.activeCoreId && props.data.cores[0]?.id === core.id);
                    return (
                      <li class={active() ? "core-row core-row--active" : "core-row"}>
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
                            disabled={active() || core.status !== "ready" || props.busy}
                            onClick={() => props.onSetActiveCore(core.id)}
                          >
                            {t(props.locale, "settings.setActive")}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => props.onRemoveCore(core.id)}>
                            <Icon name="trash-2" />
                          </Button>
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
                  <For each={clientTypes}>{(client) => <option value={client}>{client}</option>}</For>
                </select>
              </label>
              <label class="field">
                <span class="field-label">{t(props.locale, "settings.touchMode")}</span>
                <select
                  class="input"
                  value={settings().touchMode}
                  onChange={(event) => props.onUpdateSettings({ touchMode: event.currentTarget.value as TouchMode })}
                >
                  <For each={touchModes}>{(mode) => <option value={mode}>{mode}</option>}</For>
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
                <For each={connectionProfiles}>{(profile) => <option value={profile}>{profile}</option>}</For>
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
