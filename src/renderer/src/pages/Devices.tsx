import { For, Show, type Component } from "solid-js";
import type { Bootstrap, DeviceView, Locale } from "../../../shared/schemas";
import { t } from "../i18n/i18n";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { StatusPill } from "../components/ui/StatusPill";

interface DevicesProps {
  readonly data: Bootstrap;
  readonly locale: Locale;
  readonly screenshots: Readonly<Record<string, { url: string; width: number; height: number; durationMs: number }>>;
  readonly busy: boolean;
  readonly onAdd: () => void;
  readonly onConnect: (id: string) => void;
  readonly onDisconnect: (id: string) => void;
  readonly onScreenshot: (id: string) => void;
  readonly onRemove: (id: string) => void;
}

const statusText = (status: DeviceView["status"], locale: Locale): string => {
  switch (status) {
    case "online":
      return t(locale, "status.online");
    case "connecting":
      return t(locale, "status.connecting");
    case "running":
      return t(locale, "status.running");
    case "error":
      return t(locale, "status.error");
    default:
      return t(locale, "status.offline");
  }
};

const lastConnected = (timestamp: number | undefined, locale: Locale): string => {
  if (!timestamp) return t(locale, "devices.neverConnected");
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
};

export const Devices: Component<DevicesProps> = (props) => {
  const activeCore = () =>
    props.data.cores.find((core) => core.id === props.data.settings.activeCoreId) ?? props.data.cores[0];
  return (
    <div class="page page--devices">
      <header class="page-head">
        <div>
          <h1>{t(props.locale, "devices.title")}</h1>
          <p class="page-subtitle">{t(props.locale, "devices.subtitle")}</p>
        </div>
        <div class="page-actions">
          <Button variant="primary" onClick={props.onAdd} disabled={!activeCore()}>
            <Icon name="plus" />
            {t(props.locale, "devices.add")}
          </Button>
        </div>
      </header>

      <Show
        when={props.data.devices.length > 0}
        fallback={
          <div class="empty-state empty-state--devices">
            <span class="empty-icon">
              <Icon name="smartphone" />
            </span>
            <h3>{t(props.locale, "devices.empty")}</h3>
            <p>{t(props.locale, "devices.emptyHint")}</p>
            <Button variant="primary" onClick={props.onAdd}>
              <Icon name="plus" />
              {t(props.locale, "devices.add")}
            </Button>
          </div>
        }
      >
        <div class="device-grid">
          <For each={props.data.devices}>
            {(device) => {
              const connected = () => device.status === "online" || device.status === "running";
              return (
                <article class={connected() ? "device-card device-card--online" : "device-card"}>
                  <header class="device-card-head">
                    <span class="device-mark">
                      <Icon name="smartphone" />
                    </span>
                    <div class="device-heading">
                      <h2>{device.profile.name}</h2>
                      <p class="mono-line">{device.profile.address}</p>
                    </div>
                    <StatusPill status={device.status} label={statusText(device.status, props.locale)} compact />
                  </header>

                  <div class="device-shot">
                    <Show
                      when={props.screenshots[device.profile.id]}
                      fallback={
                        <div class="device-shot-empty">
                          <Icon name="camera" />
                          <span>{t(props.locale, "devices.noScreenshot")}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!connected() || props.busy}
                            onClick={() => props.onScreenshot(device.profile.id)}
                          >
                            {t(props.locale, "devices.screenshot")}
                          </Button>
                        </div>
                      }
                    >
                      {(shot) => (
                        <>
                          <img class="device-shot-image" src={shot().url} alt={`${device.profile.name} screenshot`} />
                          <span class="device-shot-meta">
                            <span>
                              {shot().width}×{shot().height} · {shot().durationMs} ms
                            </span>
                            <Show when={device.screencapCost}>
                              {(cost) => (
                                <span>
                                  core {cost().min} / {cost().avg} / {cost().max} ms
                                </span>
                              )}
                            </Show>
                          </span>
                        </>
                      )}
                    </Show>
                    <Show when={props.screenshots[device.profile.id]}>
                      <button
                        type="button"
                        class="device-shot-refresh icon-button"
                        title={t(props.locale, "devices.screenshot")}
                        disabled={!connected() || props.busy}
                        onClick={() => props.onScreenshot(device.profile.id)}
                      >
                        <Icon name="refresh-cw" />
                      </button>
                    </Show>
                  </div>

                  <dl class="device-meta">
                    <div>
                      <dt>{t(props.locale, "common.clientType")}</dt>
                      <dd>{device.profile.clientType}</dd>
                    </div>
                    <div>
                      <dt>{t(props.locale, "common.connectionConfig")}</dt>
                      <dd>{device.profile.config}</dd>
                    </div>
                    <div>
                      <dt>{t(props.locale, "devices.resolution")}</dt>
                      <dd>{device.resolution ? `${device.resolution.width}×${device.resolution.height}` : "—"}</dd>
                    </div>
                    <div>
                      <dt>{t(props.locale, "devices.lastConnected")}</dt>
                      <dd>{lastConnected(device.profile.lastConnectedAt, props.locale)}</dd>
                    </div>
                  </dl>

                  <Show when={device.lastError}>
                    {(error) => (
                      <p class="device-error">
                        <Icon name="alert-triangle" />
                        {error()}
                      </p>
                    )}
                  </Show>

                  <footer class="device-card-foot">
                    <Button
                      size="sm"
                      variant={connected() ? "ghost" : "primary"}
                      disabled={props.busy || device.status === "connecting" || !activeCore()}
                      onClick={() =>
                        connected() ? props.onDisconnect(device.profile.id) : props.onConnect(device.profile.id)
                      }
                    >
                      <Icon name={connected() ? "wifi-off" : device.status === "connecting" ? "loader" : "wifi"} />
                      {connected()
                        ? t(props.locale, "common.disconnect")
                        : device.status === "connecting"
                          ? t(props.locale, "status.connecting")
                          : t(props.locale, "common.connect")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => props.onRemove(device.profile.id)}>
                      <Icon name="trash-2" />
                      {t(props.locale, "common.remove")}
                    </Button>
                  </footer>
                </article>
              );
            }}
          </For>
          <button type="button" class="device-add-card" onClick={props.onAdd}>
            <span class="device-add-icon">
              <Icon name="plus" />
            </span>
            <strong>{t(props.locale, "devices.add")}</strong>
            <span>{t(props.locale, "devices.emptyHint")}</span>
          </button>
        </div>
      </Show>
    </div>
  );
};
