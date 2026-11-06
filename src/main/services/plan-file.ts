import { Effect, Schema } from "effect";
import { TaskConfigSchema, type TaskPlan } from "../../shared/schemas";
import { maaxError, type MaaxError } from "../errors";

/**
 * The portable task-plan file format.
 *
 * A plan leaves the app as `{ version, name, tasks }`; `version` is advisory so
 * a file written by an older build keeps importing. Only `tasks` is required,
 * and every task is validated with the same schema the app persists.
 */
export const PlanFileSchema = Schema.Struct({
  version: Schema.optional(Schema.Finite),
  name: Schema.optional(Schema.String),
  tasks: Schema.Array(TaskConfigSchema),
});
export type PlanFile = Schema.Schema.Type<typeof PlanFileSchema>;

export const decodePlanFile = (raw: unknown): Effect.Effect<PlanFile, MaaxError> =>
  Schema.decodeUnknownEffect(PlanFileSchema)(raw).pipe(
    Effect.mapError((cause) => maaxError("计划文件格式无效", cause)),
  );

export const encodePlanFile = (plan: TaskPlan): PlanFile => ({
  version: 1,
  name: plan.name,
  tasks: plan.tasks,
});

/** Strip characters the three desktop platforms reject in a file name. */
export const planFileName = (name: string): string => `${name.replace(/[^\w\u4e00-\u9fa5-]+/gu, "-")}.json`;
