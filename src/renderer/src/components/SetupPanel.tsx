import { For, type Component } from "solid-js";
import type { Locale } from "../../../shared/schemas";
import { t } from "../i18n/i18n";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

interface SetupPanelProps {
  readonly locale: Locale;
  readonly hasCore: boolean;
  readonly hasDevice: boolean;
  readonly connected: boolean;
  readonly onImportCore: () => void;
  readonly onAddDevice: () => void;
  readonly onConnect: () => void;
}

export const SetupPanel: Component<SetupPanelProps> = (props) => {
  const steps = () => [
    {
      title: t(props.locale, "setup.step1"),
      hint: t(props.locale, "setup.step1Hint"),
      done: props.hasCore,
      action: t(props.locale, "setup.import"),
      onClick: props.onImportCore,
    },
    {
      title: t(props.locale, "setup.step2"),
      hint: t(props.locale, "setup.step2Hint"),
      done: props.hasDevice,
      action: t(props.locale, "setup.addDevice"),
      onClick: props.onAddDevice,
    },
    {
      title: t(props.locale, "setup.step3"),
      hint: t(props.locale, "setup.step3Hint"),
      done: props.connected,
      action: t(props.locale, "setup.connect"),
      onClick: props.onConnect,
    },
  ];

  return (
    <section class="setup-panel">
      <div class="setup-head">
        <h2>{t(props.locale, "setup.title")}</h2>
        <p>{t(props.locale, "setup.subtitle")}</p>
      </div>
      <ol class="setup-steps">
        <For each={steps()}>
          {(step, index) => (
            <li class={step.done ? "setup-step setup-step--done" : "setup-step"}>
              <span class="setup-index">{step.done ? <Icon name="check" /> : index() + 1}</span>
              <span class="setup-copy">
                <strong>{step.title}</strong>
                <span>{step.hint}</span>
              </span>
              <Button
                size="sm"
                variant={step.done ? "ghost" : "secondary"}
                disabled={step.done}
                onClick={step.onClick}
              >
                {step.done ? t(props.locale, "setup.done") : step.action}
              </Button>
            </li>
          )}
        </For>
      </ol>
    </section>
  );
};
