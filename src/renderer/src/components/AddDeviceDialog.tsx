import { For, createEffect, createSignal, untrack, type Component } from "solid-js";
import type { AppSettings, ClientType, Locale } from "../../../shared/schemas";
import type { DeviceDraft } from "../../../shared/schemas";
import { t } from "../i18n/i18n";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";

interface AddDeviceDialogProps {
  readonly open: boolean;
  readonly locale: Locale;
  readonly settings: AppSettings;
  readonly onClose: () => void;
  readonly onSubmit: (draft: DeviceDraft) => void;
}

const CLIENT_TYPES: ReadonlyArray<ClientType> = ["Official", "Bilibili", "txwy", "YoStarEN", "YoStarJP", "YoStarKR"];

const CONNECTION_PROFILES = ["General", "MuMuEmulator12", "LDPlayer", "Nox", "XYAZ", "WSA", "Androws"];

export const AddDeviceDialog: Component<AddDeviceDialogProps> = (props) => {
  const [name, setName] = createSignal("");
  const [address, setAddress] = createSignal("");
  const [adbPath, setAdbPath] = createSignal("");
  const [config, setConfig] = createSignal("General");
  const [clientType, setClientType] = createSignal<ClientType>("Official");
  const [remark, setRemark] = createSignal("");
  const [error, setError] = createSignal("");
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
      // Focus explicitly: an `autofocus` attribute is rejected by Chromium when the
      // launcher button still holds focus ("Autofocus processing was blocked").
      addressEl?.focus();
    },
  );

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
          <span class="field-label">{t(props.locale, "common.adbPath")}</span>
          <input
            class="input input--mono"
            value={adbPath()}
            placeholder={t(props.locale, "devices.adbPlaceholder")}
            onInput={(event) => setAdbPath(event.currentTarget.value)}
          />
        </label>
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
