import { Schema } from "effect";
import type { IpcError } from "../shared/schemas";

export class MaaxError extends Schema.TaggedError<MaaxError, { readonly brand: unique symbol }>()(
  "MaaxError",
  {
    message: Schema.String,
    detail: Schema.optional(Schema.String),
  },
) {}

export const maaxError = (message: string, cause?: unknown): MaaxError =>
  new MaaxError({
    message,
    detail:
      cause instanceof Error ? cause.message : cause === undefined ? undefined : String(cause),
  });

export function describeError(error: unknown): IpcError {
  if (error instanceof MaaxError) {
    return { tag: error._tag, message: error.message, detail: error.detail };
  }

  if (error instanceof Error) {
    return { tag: error.name || "Error", message: error.message, detail: error.stack };
  }

  return { tag: "Error", message: String(error) };
}
