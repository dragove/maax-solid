import { Effect, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { dirname } from "node:path";

/** Read JSON with a schema; corrupt or missing files fall back gracefully. */
export const readJson = <A>(
  path: string,
  schema: Schema.ConstraintDecoder<unknown>,
  fallback: A,
): Effect.Effect<A, never, FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const exists = yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false));
    if (!exists) return fallback;

    const text = yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => undefined));
    if (text === undefined) return fallback;

    try {
      const decode = Schema.decodeUnknownSync(schema);
      return decode(JSON.parse(text)) as A;
    } catch {
      return fallback;
    }
  });

/** Write JSON through a temporary sibling file, then rename atomically. */
export const writeJson = <A>(path: string, value: A): Effect.Effect<void, never, FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const directory = dirname(path);
    yield* fs
      .makeDirectory(directory, { recursive: true })
      .pipe(Effect.orElseSucceed(() => undefined));
    const text = JSON.stringify(value, null, 2);
    const temp = `${path}.${process.pid}.tmp`;
    yield* fs.writeFileString(temp, text).pipe(Effect.orElseSucceed(() => undefined));
    yield* fs.rename(temp, path).pipe(Effect.orElseSucceed(() => undefined));
  });
