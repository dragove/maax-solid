import type { Component } from "solid-js";
import type { DownloadProgress, Locale } from "../../../../shared/schemas";
import { t, type MessageKey } from "../../i18n/i18n";
import { Icon } from "./Icon";

interface ProgressBarProps {
  readonly title: string;
  readonly progress: DownloadProgress;
  readonly locale: Locale;
}

/** Floating status bar shared by core downloads and resource updates. */
export const ProgressBar: Component<ProgressBarProps> = (props) => {
  const percent = (): number =>
    props.progress.total > 0 ? Math.min(100, Math.round((props.progress.received / props.progress.total) * 100)) : 0;
  const phaseLabel = (): string => t(props.locale, `download.${props.progress.phase}` as MessageKey);

  return (
    <div class="download-bar">
      <span class="download-icon">
        <Icon
          name={
            props.progress.phase === "done"
              ? "check"
              : props.progress.phase === "failed"
                ? "alert-triangle"
                : "download"
          }
        />
      </span>
      <div class="download-copy">
        <div class="download-head">
          <strong>{props.title}</strong>
          <span>
            {props.progress.phase === "downloading" && props.progress.total > 0 ? `${percent()}%` : phaseLabel()}
          </span>
        </div>
        <div class="download-track">
          <span style={{ width: props.progress.total > 0 ? `${percent()}%` : "12%" }} />
        </div>
        <span class="download-meta">
          {props.progress.phase === "downloading"
            ? `${(props.progress.received / 1024 / 1024).toFixed(1)} / ${(props.progress.total / 1024 / 1024).toFixed(1)} MB`
            : phaseLabel()}
        </span>
      </div>
    </div>
  );
};
