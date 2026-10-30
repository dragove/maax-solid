import { For, Show, createEffect, createSignal, untrack, type Component } from "solid-js";
import type { AppSettings, ClientType, DiscoveredDevice, DeviceDiscovery, Locale } from "../../../shared/schemas";
import type { DeviceDraft } from "../../../shared/schemas";
import { t } from "../i18n/i18n";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { Modal } from "./ui/Modal";

interface AddDeviceDialogProps {
  readonly open: boolean;
  readonly locale: Locale;
  readonly settings: AppSettings;
  readonly onClose: () => void;
  readonly onDiscover: (adbPath: string) => Promise<DeviceDiscovery | undefined>;
  readonly onSubmit: (draft: DeviceDraft) => void;
}

const CLIENT_TYPES: ReadonlyArray<ClientType> = ["Official", "Bilibili", "txwy", "YoStarEN", "YoStarJP", "YoStarKR"];

const CONNECTION_PROFILES = ["General", "MuMuEmulator12", "LDPlayer", "Nox", "BlueStacks", "XYAZ", "WSA", "Androws"];

const emulatorLabelKey = (emulator: DiscoveredDevice["emulator"]): Parameters<typeof t>[1] => {
  switch (emulator) {
    case "mumu":
      return "devices.emulator.mumu";
    case "nox":
      return "devices.emulator.nox";
    default:
      return "devices.emulator.generic";
  }
};

export const AddDeviceDialog: Component<AddDeviceDialogProps> = (props) => {
  const [name, setName] = createSignal("");
  const [address, setAddress] = createSignal("");
  const [adbPath, setAdbPath] = createSignal("");
  const [config, setConfig] = createSignal("General");
  const [clientType, setClientType] = createSignal<ClientType>("Official");
  const [remark, setRemark] = createSignal("");
  const [error, setError] = createSignal("");
  const [discovering, setDiscovering] = createSignal(false);
  const [discovered, setDiscovered] = createSignal<ReadonlyArray<DiscoveredDevice>>([]);
  const [discoveredAdb, setDiscoveredAdb] = createSignal("");
  const [discoverHint, setDiscoverHint] = createSignal("");
  let addressEl: HTMLInputElement | undefined;

  // Seed the form when the dialog opens: `open` is the tracked trigger, and the
  // settings are deliberately a snapshot taken at that moment.
  createEffect(
    () => props.open,
    (open) => {
      if (!open) return;
      const settings = untrack(() => props.settings);
      setName("");
      setAddress("");
      setAdbPath("");
      setConfig(settings.connectionConfig);
      setClientType(settings.clientType);
      setRemark("");
      setError("");
      setDiscovering(false);
      setDiscovered([]);
      setDiscoveredAdb("");
      setDiscoverHint("");
      // Focus explicitly: an `autofocus` attribute is rejected by Chromium when the
      // launcher button still holds focus ("Autofocus processing was blocked").
      addressEl?.focus();
    },
  );

  const deviceName = (device: DiscoveredDevice): string =>
    `${t(props.locale, emulatorLabelKey(device.emulator))} · ${device.model ?? device.serial}`;

  const discover = async (): Promise<void> => {
    if (discovering()) return;
    setDiscovering(true);
    setDiscovered([]);
    setDiscoveredAdb("");
    setDiscoverHint("");
    try {
      const result = await props.onDiscover(adbPath().trim() || untrack(() => props.settings.adbPath));
      if (!result) return;
      setDiscovered(result.devices);
      setDiscoveredAdb(result.adbPath);
      setAdbPath((current) => (current.trim() === "" ? result.adbPath : current));
      if (result.warning) setDiscoverHint(result.warning);
      else if (result.devices.length === 0) setDiscoverHint(t(props.locale, "devices.detectEmpty"));
    } finally {
      setDiscovering(false);
    }
  };

  const choose = (device: DiscoveredDevice): void => {
    setName(deviceName(device));
    setAddress(device.serial);
    setConfig(device.config);
    if (discoveredAdb() !== "") setAdbPath(discoveredAdb());
    setError("");
  };

  const submit = (event?: SubmitEvent): void => {
    event?.preventDefault();
    if (address().trim() === "") {
      setError(props.locale === "en-US" ? "An ADB address is required." : "请填写 ADB 地址。");
      return;
    }
    props.onSubmit({
      name: name().trim() || address().trim(),
      address: address().trim(),
      adbPath: adbPath().trim(),
      config: config(),
      clientType: clientType(),
      remark: remark().trim(),
    });
  };

  return (
    <Modal
      open={props.open}
      title={t(props.locale, "devices.addTitle")}
      description={t(props.locale, "devices.formHint")}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            {t(props.locale, "common.cancel")}
          </Button>
          <Button variant="primary" type="submit" onClick={() => submit()}>
            {t(props.locale, "common.add")}
          </Button>
        </>
      }
    >
      <form class="form-stack" onSubmit={submit}>
        <label class="field">
          <span class="field-label">{t(props.locale, "common.name")}</span>
          <input
            class="input"
            value={name()}
            placeholder={t(props.locale, "devices.namePlaceholder")}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <label class="field">
          <span class="field-label">{t(props.locale, "common.address")}</span>
          <input
            class="input input--mono"
            value={address()}
            placeholder={t(props.locale, "devices.addressPlaceholder")}
            ref={(element) => {
              addressEl = element;
            }}
            onInput={(event) => setAddress(event.currentTarget.value)}
          />
        </label>
        <div class="field">
          <span class="field-label">{t(props.locale, "common.adbPath")}</span>
          <div class="input-row">
            <input
              class="input input--mono"
              value={adbPath()}
              placeholder={t(props.locale, "devices.adbPlaceholder")}
              onInput={(event) => setAdbPath(event.currentTarget.value)}
            />
            <Button size="sm" variant="secondary" disabled={discovering()} onClick={() => void discover()}>
              <Icon name={discovering() ? "loader" : "search"} />
              {t(props.locale, discovering() ? "devices.detecting" : "devices.detect")}
            </Button>
          </div>
        </div>
        <Show when={discoverHint() !== "" || discovered().length > 0}>
          <div class="device-detect">
            <Show when={discoverHint()}>{(hint) => <p class="device-detect-hint">{hint()}</p>}</Show>
            <Show when={discovered().length > 0}>
              <p class="device-detect-label">
                {t(props.locale, "devices.detected")}
                <span class="mono-line">{discoveredAdb()}</span>
              </p>
              <For each={discovered()} keyed={(device) => device.serial}>
                {(device) => (
                  <button type="button" class="device-detect-item" onClick={() => choose(device())}>
                    <span class="device-detect-name">{deviceName(device())}</span>
                    <span class="device-detect-serial mono-line">{device().serial}</span>
                    <span class="device-detect-config">{device().config}</span>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </Show>
        <div class="form-grid">
          <label class="field">
            <span class="field-label">{t(props.locale, "common.connectionConfig")}</span>
            <select class="input" value={config()} onChange={(event) => setConfig(event.currentTarget.value)}>
              <For each={CONNECTION_PROFILES}>
                {(profile) => (
                  <option value={profile} selected={profile === config()}>
                    {profile}
                  </option>
                )}
              </For>
            </select>
          </label>
          <label class="field">
            <span class="field-label">{t(props.locale, "common.clientType")}</span>
            <select
              class="input"
              value={clientType()}
              onChange={(event) => setClientType(event.currentTarget.value as ClientType)}
            >
              <For each={CLIENT_TYPES}>
                {(client) => (
                  <option value={client} selected={client === clientType()}>
                    {client}
                  </option>
                )}
              </For>
            </select>
          </label>
        </div>
        <label class="field">
          <span class="field-label">{t(props.locale, "common.remark")}</span>
          <input
            class="input"
            value={remark()}
            placeholder={t(props.locale, "devices.remarkPlaceholder")}
            onInput={(event) => setRemark(event.currentTarget.value)}
          />
        </label>
        {error() ? <p class="form-error">{error()}</p> : null}
      </form>
    </Modal>
  );
};
