import { Schema } from "effect";
import type { IpcError } from "../shared/schemas";

export class MaaxError extends Schema.TaggedError<MaaxError, { readonly brand: unique symbol }>()("MaaxError", {
  message: Schema.String,
  detail: Schema.optional(Schema.String),
}) {}

/** `cause` is untrusted at every adapter boundary, so format it without throwing. */
const describeCause = (cause: unknown): string | undefined => {
  if (cause === undefined) return undefined;
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) return cause.message;
  try {
    return JSON.stringify(cause) ?? Object.prototype.toString.call(cause);
  } catch {
    return Object.prototype.toString.call(cause);
  }
};

export const maaxError = (message: string, cause?: unknown): MaaxError =>
  new MaaxError({ message, detail: describeCause(cause) });

export function describeError(error: unknown): IpcError {
  if (error instanceof MaaxError) {
    return { tag: error._tag, message: error.message, detail: error.detail };
  }

  if (error instanceof Error) {
    return { tag: error.name || "Error", message: error.message, detail: error.stack };
  }

  return { tag: "Error", message: describeCause(error) ?? "未知错误" };
}
