import type { Component } from "solid-js";
import type { DeviceStatus, EnginePhase, RunStatus } from "../../../../shared/schemas";
import { Icon } from "./Icon";

interface StatusPillProps {
  readonly status: DeviceStatus | EnginePhase | RunStatus;
  readonly label: string;
  readonly compact?: boolean;
}

/** Only in-flight states animate; every settled state must stay still. */
const isActive = (status: string): boolean =>
  status === "running" || status === "starting" || status === "connecting" || status === "preparing";

const isSettled = (status: string): boolean => status === "online" || status === "ready" || status === "completed";

const isBroken = (status: string): boolean => status === "error" || status === "crashed" || status === "failed";

const toneFor = (status: string): string => {
  if (isSettled(status)) return "ok";
  if (isActive(status)) return "busy";
  if (isBroken(status)) return "bad";
  return "muted";
};

const iconFor = (status: string): string => {
  if (status === "completed") return "check";
  if (status === "online" || status === "ready") return "wifi";
  if (isActive(status)) return "loader";
  if (isBroken(status)) return "alert-triangle";
  if (status === "stopped") return "square";
  return "wifi-off";
};

export const StatusPill: Component<StatusPillProps> = (props) => (
  <span class={`status-pill status-pill--${toneFor(props.status)}`}>
    <Icon name={iconFor(props.status)} class={isActive(props.status) ? "spin" : "status-icon"} />
    <span>{props.label}</span>
  </span>
);
