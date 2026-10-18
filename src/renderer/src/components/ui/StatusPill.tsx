import type { Component } from "solid-js";
import type { DeviceStatus, EnginePhase } from "../../../../shared/schemas";
import { Icon } from "./Icon";

interface StatusPillProps {
  readonly status: DeviceStatus | EnginePhase;
  readonly label: string;
  readonly compact?: boolean;
}

const toneFor = (status: string): string => {
  if (status === "online" || status === "ready") return "ok";
  if (status === "running" || status === "starting" || status === "connecting") return "busy";
  if (status === "error" || status === "crashed") return "bad";
  return "muted";
};

const iconFor = (status: string): string => {
  if (status === "online" || status === "ready") return "wifi";
  if (status === "running" || status === "starting" || status === "connecting") return "loader";
  if (status === "error" || status === "crashed") return "alert-triangle";
  return "wifi-off";
};

export const StatusPill: Component<StatusPillProps> = (props) => (
  <span class={`status-pill status-pill--${toneFor(props.status)}`}>
    <Icon
      name={iconFor(props.status)}
      class={
        props.status === "starting" || props.status === "connecting" || props.status === "running"
          ? "spin"
          : "status-icon"
      }
    />
    <span>{props.label}</span>
  </span>
);
