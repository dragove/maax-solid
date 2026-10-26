import { copilotItemActive, copilotItemEntries, readCopilotBatch } from "./copilot-mode";
import type { AppSettings, CopilotSetup, TaskConfig, TaskType } from "./schemas";

/**
 * Declarative task catalogue shared by the renderer forms and the main process
 * builder. MaaCore does not publish a machine-readable schema for
 * `AsstAppendTask`, so this file owns the supported subset and its defaults.
 */
export interface LocalizedText {
  readonly zh: string;
  readonly en: string;
}

export type FieldKind = "switch" | "number" | "text" | "stage" | "select" | "multi-select" | "tags" | "file" | "opers";

export interface FieldOption {
  readonly value: string | number;
  readonly label: LocalizedText;
}

export interface TaskField {
  readonly key: string;
  readonly kind: FieldKind;
  readonly label: LocalizedText;
  readonly description?: LocalizedText;
  readonly placeholder?: LocalizedText;
  /** Static list, or a function of the current params when the theme owns the choices. */
  readonly options?: ReadonlyArray<FieldOption> | ((params: Record<string, unknown>) => ReadonlyArray<FieldOption>);
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly advanced?: boolean;
  /** File-backed fields own their picker: copilot JSON goes through the PRTS
   * importer, a video is only referenced by its picked path. */
  readonly accept?: "video";
  /** The task cannot be started until this field has a value. */
  readonly required?: boolean;
  /** Custom presence rule; defaults to "non-empty string/number/array". */
  readonly satisfies?: (params: Record<string, unknown>) => boolean;
  readonly visibleWhen?: (params: Record<string, unknown>) => boolean;
}

/** Resolve a field's options for the current params (theme-dependent lists). */
export const fieldOptions = (field: TaskField, params: Record<string, unknown>): ReadonlyArray<FieldOption> =>
  typeof field.options === "function" ? field.options(params) : (field.options ?? []);

export interface TaskDefinition {
  readonly type: TaskType;
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  readonly icon: string;
  readonly fields: ReadonlyArray<TaskField>;
}

const numberOptions = (values: ReadonlyArray<number>): ReadonlyArray<FieldOption> =>
  values.map((value) => ({ value, label: { zh: String(value), en: String(value) } }));

const paramNumber = (params: Record<string, unknown>, key: string): number =>
  typeof params[key] === "number" ? (params[key] as number) : Number(params[key] ?? 0);

const paramString = (params: Record<string, unknown>, key: string): string =>
  typeof params[key] === "string" ? (params[key] as string) : "";

const paramFlag = (params: Record<string, unknown>, key: string): boolean => params[key] === true;

/** A field option the current theme may not offer. */
interface ThemedOption extends FieldOption {
  readonly themes?: ReadonlyArray<string>;
}

const ROGUELIKE_THEME_OPTIONS: ReadonlyArray<FieldOption> = [
  { value: "Phantom", label: { zh: "傀影与猩红血钻", en: "Phantom & Crimson Solitaire" } },
  { value: "Mizuki", label: { zh: "水月与深蓝之树", en: "Mizuki & Caerula Arbor" } },
  { value: "Sami", label: { zh: "探索者的银凇止境", en: "Expeditioner's Jǫklumarkar" } },
  { value: "Sarkaz", label: { zh: "萨卡兹的无终奇语", en: "Tales of the Unfathomable" } },
  { value: "JieGarden", label: { zh: "岁的界园志异", en: "Sui's Garden of Grotesqueries" } },
  { value: "BlackFlow", label: { zh: "黑流树海", en: "Blackflow" } },
];

/** Theme ids in core order; also whitelists the resource lookup in main. */
export const ROGUELIKE_THEMES: ReadonlyArray<string> = ROGUELIKE_THEME_OPTIONS.map((option) => String(option.value));

/** Highest in-game difficulty per theme; unused in monthly-squad and exploration modes. */
const ROGUELIKE_MAX_DIFFICULTY: Readonly<Record<string, number>> = {
  Phantom: 15,
  Mizuki: 18,
  Sami: 15,
  Sarkaz: 18,
  JieGarden: 18,
  BlackFlow: 16,
};

/** MaaCore's sentinel for "swipe to the last entry", i.e. the highest unlocked difficulty. */
const ROGUELIKE_MAX_DIFFICULTY_VALUE = 2147483647;

const normalizeRoguelikeTheme = (theme: string): string => (ROGUELIKE_THEMES.includes(theme) ? theme : "Phantom");

/**
 * Modes MaaCore accepts per theme (`RoguelikeConfig::is_valid_mode`). A mode
 * carried over from another theme makes the whole task parameter set fail, so
 * both the form and the builder clamp it instead of forwarding it.
 */
const ROGUELIKE_MODE_VALUES: Readonly<Record<string, ReadonlyArray<number>>> = {
  Phantom: [0, 1, 4, 6, 7],
  Mizuki: [0, 1, 4, 6, 7],
  Sami: [0, 1, 4, 5, 6, 7],
  Sarkaz: [0, 1, 4, 6, 7],
  JieGarden: [0, 1, 4, 6, 7, 20001],
  BlackFlow: [0, 1, 30003],
};

const ROGUELIKE_MODE_OPTIONS: ReadonlyArray<FieldOption> = [
  { value: 0, label: { zh: "刷等级，尽可能多打层数", en: "Gain experience, clear as far as possible" } },
  { value: 1, label: { zh: "刷源石锭，投资完自动退出", en: "Farm Originium Ingots, exit after investing" } },
  { value: 4, label: { zh: "刷开局（热水壶 / 精二直升）", en: "Farm a starting reward or Elite 2 start" } },
  { value: 5, label: { zh: "刷坍缩范式", en: "Farm Collapsal Paradigms" } },
  { value: 6, label: { zh: "月度小队", en: "Monthly squad" } },
  { value: 7, label: { zh: "深入调查", en: "Deep investigation" } },
  { value: 20001, label: { zh: "刷常乐节点", en: "Farm Playtime nodes" } },
  { value: 30003, label: { zh: "刷开局，命中后保留这一局", en: "Farm starting rewards, keep the run" } },
];

export const roguelikeModeValues = (theme: string): ReadonlyArray<number> =>
  ROGUELIKE_MODE_VALUES[normalizeRoguelikeTheme(theme)] ?? [0];

export const roguelikeModeOptions = (theme: string): ReadonlyArray<FieldOption> => {
  const allowed = roguelikeModeValues(theme);
  return ROGUELIKE_MODE_OPTIONS.filter((option) => allowed.includes(Number(option.value)));
};

/** Idempotent clamp shared by the param writer and the payload builder. */
export const roguelikeModeFor = (theme: string, mode: number): number =>
  roguelikeModeValues(theme).includes(mode) ? mode : 0;

/**
 * The core reads `-1` as "keep the current difficulty", `INT_MAX` as "highest"
 * and anything else as a concrete level. A level the theme does not have would
 * leave the selector on a value that is not on screen.
 */
export const roguelikeDifficultyOptions = (theme: string): ReadonlyArray<FieldOption> => {
  const max = ROGUELIKE_MAX_DIFFICULTY[normalizeRoguelikeTheme(theme)] ?? 15;
  const levels = Array.from({ length: max + 1 }, (_, index) => max - index);
  return [
    { value: -1, label: { zh: "不切换", en: "Don't switch" } },
    { value: ROGUELIKE_MAX_DIFFICULTY_VALUE, label: { zh: `最高（${max}）`, en: `Max (${max})` } },
    ...levels.map((level) => ({ value: level, label: { zh: String(level), en: String(level) } })),
  ];
};

export const roguelikeDifficultyValue = (theme: string, difficulty: number): number =>
  roguelikeDifficultyOptions(theme).some((option) => Number(option.value) === difficulty) ? difficulty : -1;

const ROGUELIKE_ROLE_OPTIONS: ReadonlyArray<ThemedOption> = [
  { value: "先手必胜", label: { zh: "先手必胜（先锋、狙击、特种）", en: "First Move Advantage" } },
  { value: "稳扎稳打", label: { zh: "稳扎稳打（重装、术师、狙击）", en: "Slow and Steady" } },
  { value: "取长补短", label: { zh: "取长补短（近卫、辅助、医疗）", en: "Overcoming Weaknesses" } },
  {
    value: "灵活部署",
    label: { zh: "灵活部署（先锋、辅助、特种）", en: "Flexible Deployment" },
    themes: ["JieGarden", "BlackFlow"],
  },
  {
    value: "坚不可摧",
    label: { zh: "坚不可摧（重装、术师、医疗）", en: "Unbreakable" },
    themes: ["JieGarden", "BlackFlow"],
  },
  { value: "随心所欲", label: { zh: "随心所欲（三张随机）", en: "As Your Heart Desires" } },
];

/** A stored role the theme no longer offers stays selectable instead of silently showing another one. */
export const roguelikeRoleOptions = (theme: string, current: unknown): ReadonlyArray<FieldOption> => {
  const normalized = normalizeRoguelikeTheme(theme);
  const options = ROGUELIKE_ROLE_OPTIONS.filter(
    (option) => option.themes === undefined || option.themes.includes(normalized),
  ).map((option) => ({ value: option.value, label: option.label }));
  const value = typeof current === "string" ? current.trim() : "";
  return value !== "" && !options.some((option) => String(option.value) === value)
    ? [...options, { value, label: { zh: value, en: value } }]
    : options;
};

/** Rewards offered by the mode-4 opening reset; the core wants a flag object. */
const COLLECTIBLE_REWARDS: ReadonlyArray<ThemedOption> = [
  { value: "hot_water", label: { zh: "热水壶", en: "Hot water" } },
  { value: "shield", label: { zh: "护盾", en: "Shield" } },
  { value: "ingot", label: { zh: "源石锭", en: "Ingot" } },
  { value: "hope", label: { zh: "希望", en: "Hope" }, themes: ["Phantom", "Mizuki", "Sami", "Sarkaz"] },
  { value: "random", label: { zh: "随机奖励", en: "Random reward" } },
  { value: "key", label: { zh: "钥匙", en: "Key" }, themes: ["Mizuki"] },
  { value: "dice", label: { zh: "骰子", en: "Dice" }, themes: ["Mizuki"] },
  { value: "ideas", label: { zh: "构想 ×2", en: "2 Ideas" }, themes: ["Sarkaz"] },
  { value: "ticket", label: { zh: "票券", en: "Ticket" }, themes: ["JieGarden"] },
];

export const collectibleRewardOptions = (theme: string): ReadonlyArray<FieldOption> => {
  const normalized = normalizeRoguelikeTheme(theme);
  return COLLECTIBLE_REWARDS.filter((option) => option.themes === undefined || option.themes.includes(normalized)).map(
    (option) => ({ value: option.value, label: option.label }),
  );
};

/** At most three starting recruits; their classes must differ in game. */
export const ROGUELIKE_STARTING_OPERS = 3;

export interface StartingOper {
  readonly name: string;
  readonly useSupport: boolean;
}

export const readStartingOpers = (value: unknown): ReadonlyArray<StartingOper> =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        if (typeof item !== "object" || item === null) return [];
        const record = item as Record<string, unknown>;
        return [{ name: typeof record.name === "string" ? record.name : "", useSupport: record.useSupport === true }];
      })
    : [];

const BLACKFLOW_SERPENT = "swaddled_feathered_serpent";

const BLACKFLOW_ANIMAL_OPTIONS: ReadonlyArray<FieldOption> = [
  { value: "swaddled_cat", label: { zh: "襁褓中的猫", en: "Swaddled Cat" } },
  { value: "swaddled_dog", label: { zh: "襁褓中的狗", en: "Swaddled Dog" } },
  { value: "swaddled_cerberus", label: { zh: "襁褓三头犬", en: "Swaddled Cerberus" } },
  { value: BLACKFLOW_SERPENT, label: { zh: "襁褓羽蛇", en: "Swaddled Feathered Serpent" } },
];

/** Requirement slots; the core takes 0-2 animals and at most one feathered serpent. */
export const blackflowAnimalOptions = (other: unknown): ReadonlyArray<FieldOption> => [
  { value: "", label: { zh: "不要求", en: "No requirement" } },
  ...BLACKFLOW_ANIMAL_OPTIONS.filter((option) => option.value !== BLACKFLOW_SERPENT || other !== BLACKFLOW_SERPENT),
];

export const hasBlackflowSerpent = (params: Record<string, unknown>): boolean =>
  params.blackflow_animal_1 === BLACKFLOW_SERPENT || params.blackflow_animal_2 === BLACKFLOW_SERPENT;

interface BlackflowReward {
  readonly id: string;
  readonly label: LocalizedText;
  /** The six blue cards only a feathered serpent in the preparation run brings. */
  readonly serpent: boolean;
}

const BLACKFLOW_REWARDS: ReadonlyArray<BlackflowReward> = [
  { id: "unnumbered_item", label: { zh: "未编号物", en: "Unnumbered Item" }, serpent: false },
  { id: "survey_advance", label: { zh: "调查预付款", en: "Survey Advance" }, serpent: false },
  { id: "space_lease", label: { zh: "空间租赁", en: "Space Lease" }, serpent: false },
  { id: "regression_compensation", label: { zh: "退行补偿", en: "Regression Compensation" }, serpent: false },
  { id: "forest_ride", label: { zh: "林间代步", en: "Forest Ride" }, serpent: false },
  { id: "nest_parasitism", label: { zh: "巢寄生", en: "Nest Parasitism" }, serpent: false },
  { id: "pegasus", label: { zh: "襁褓天马", en: "Swaddled Pegasus" }, serpent: true },
  { id: "hippogriff", label: { zh: "襁褓骏鹰", en: "Swaddled Hippogriff" }, serpent: true },
  { id: "dragon", label: { zh: "襁褓巨龙", en: "Swaddled Dragon" }, serpent: true },
  { id: "hydra", label: { zh: "襁褓九头蛇", en: "Swaddled Hydra" }, serpent: true },
  { id: "bai_ze", label: { zh: "襁褓白泽", en: "Swaddled Bai Ze" }, serpent: true },
  { id: "golden_crow", label: { zh: "襁褓金乌", en: "Swaddled Golden Crow" }, serpent: true },
];

/** MAA's recommended pick order, used when utopia is on and nothing else was ordered. */
const BLACKFLOW_REWARD_PRIORITY: ReadonlyArray<string> = [
  "pegasus",
  "space_lease",
  "forest_ride",
  "unnumbered_item",
  "regression_compensation",
  "survey_advance",
  "nest_parasitism",
  "hippogriff",
  "dragon",
  "hydra",
  "bai_ze",
  "golden_crow",
];

const readStringList = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export const blackflowRewardOptions = (serpent: boolean): ReadonlyArray<FieldOption> =>
  BLACKFLOW_REWARDS.filter((reward) => !reward.serpent || serpent).map((reward) => ({
    value: reward.id,
    label: reward.label,
  }));

export const blackflowRewardPriorityOptions = (): ReadonlyArray<FieldOption> =>
  BLACKFLOW_REWARDS.map((reward) => ({ value: reward.id, label: reward.label }));

/** Bit positions match the core's `blackflow_start_rewards` mask. */
export const blackflowRewardMask = (value: unknown, withSerpent: boolean): number => {
  const picked = readStringList(value);
  return BLACKFLOW_REWARDS.reduce((mask, reward, index) => {
    if (reward.serpent && !withSerpent) return mask;
    return picked.includes(reward.id) ? mask | (1 << index) : mask;
  }, 0);
};

/** First picked card wins, so the stored order is preserved; empty falls back to MAA's order. */
export const blackflowRewardPriority = (value: unknown): ReadonlyArray<string> => {
  const known = new Set(BLACKFLOW_REWARDS.map((reward) => reward.id));
  const picked = [...new Set(readStringList(value).filter((id) => known.has(id)))];
  return picked.length > 0 ? picked : BLACKFLOW_REWARD_PRIORITY;
};

export const TASK_DEFINITIONS: Readonly<Record<TaskType, TaskDefinition>> = {
  StartUp: {
    type: "StartUp",
    name: { zh: "开始唤醒", en: "Start Up" },
    description: {
      zh: "启动游戏并进入主界面，可作为其他任务的前置步骤。",
      en: "Launch the game and reach the main screen before running other tasks.",
    },
    icon: "power",
    fields: [
      {
        key: "start_game_enabled",
        kind: "switch",
        label: { zh: "自动启动客户端", en: "Launch client automatically" },
      },
      {
        key: "account_name",
        kind: "text",
        label: { zh: "切换账号", en: "Switch account" },
        description: {
          zh: "仅支持切换到已登录账号，可填写登录名的一部分。",
          en: "Only already signed-in accounts can be selected. A unique fragment of the login name is enough.",
        },
        placeholder: { zh: "留空则不切换", en: "Leave empty to keep the current account" },
        advanced: true,
      },
    ],
  },
  Fight: {
    type: "Fight",
    name: { zh: "理智作战", en: "Combat" },
    description: {
      zh: "按关卡、药剂和次数自动刷取材料。",
      en: "Farm a stage with sanity potions and a battle limit.",
    },
    icon: "swords",
    fields: [
      {
        key: "stage",
        kind: "stage",
        label: { zh: "关卡", en: "Stage" },
        description: {
          zh: "主线的 1-7、剿灭、资源本（CE-6 / LS-6 / CA-5）或活动关卡。留空则识别当前关卡。",
          en: "Main stage such as 1-7, annihilation, resource stages (CE-6 / LS-6 / CA-5) or event stages. Leave empty to use the current stage.",
        },
        placeholder: { zh: "例如 1-7、CE-6、Annihilation", en: "e.g. 1-7, CE-6, Annihilation" },
      },
      {
        key: "medicine",
        kind: "number",
        label: { zh: "使用理智药", en: "Sanity potions" },
        min: 0,
        max: 99,
        step: 1,
        description: {
          zh: "最多使用的理智药数量，0 表示不使用。",
          en: "Maximum potions to use. 0 means none.",
        },
      },
      {
        key: "stone",
        kind: "number",
        label: { zh: "碎石上限", en: "Originite Prime limit" },
        min: 0,
        max: 99,
        step: 1,
        description: {
          zh: "最多碎石的次数，0 表示不碎石。",
          en: "Maximum Originite Prime to spend. 0 means none.",
        },
        advanced: true,
      },
      {
        key: "medicine_expire_days",
        kind: "number",
        label: { zh: "临期药天数", en: "Expiring medicine days" },
        min: 0,
        max: 14,
        step: 1,
        description: {
          zh: "使用将在指定天数内过期的理智药。0 表示不使用临期药。",
          en: "Use potions expiring within this many days. 0 disables it.",
        },
        advanced: true,
      },
      {
        key: "times",
        kind: "number",
        label: { zh: "战斗次数", en: "Battle limit" },
        min: 0,
        max: 9999,
        step: 1,
        description: { zh: "0 表示直到理智耗尽。", en: "0 means until sanity runs out." },
      },
      {
        key: "series",
        kind: "select",
        label: { zh: "代理倍率", en: "Consecutive battles" },
        options: [
          { value: 0, label: { zh: "自动（推荐）", en: "Auto (recommended)" } },
          { value: -1, label: { zh: "不切换", en: "Do not switch" } },
          ...numberOptions([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
        ],
        description: {
          zh: "自动会按当前理智选择本次可连续作战的最大次数；不切换则保持游戏当前设置。7–10 仅在支持新倍率列表的服务器可用。",
          en: "Auto picks the largest available run for the current sanity; Do not switch leaves the in-game setting untouched. 7–10 requires the newer series list on the current resource.",
        },
      },
      {
        key: "DrGrandet",
        kind: "switch",
        label: { zh: "省理智碎石模式", en: "Sanity-saving Originite mode" },
        description: {
          zh: "只在需要碎石时生效，等待理智自然恢复后再行动。",
          en: "Only relevant when Originite Prime would be spent; waits for natural sanity recovery first.",
        },
        advanced: true,
      },
    ],
  },
  Recruit: {
    type: "Recruit",
    name: { zh: "自动公招", en: "Recruitment" },
    description: {
      zh: "自动识别标签、刷新并完成公开招募。",
      en: "Recognise tags, refresh them and complete recruitment automatically.",
    },
    icon: "users",
    fields: [
      {
        key: "select",
        kind: "multi-select",
        label: { zh: "自动选择星级", en: "Auto-select rarities" },
        options: numberOptions([3, 4, 5]),
      },
      {
        key: "confirm",
        kind: "multi-select",
        label: { zh: "自动确认星级", en: "Auto-confirm rarities" },
        options: numberOptions([3, 4, 5]),
      },
      {
        key: "refresh",
        kind: "switch",
        label: { zh: "刷新三星标签", en: "Refresh 3★ tags" },
      },
      {
        key: "times",
        kind: "number",
        label: { zh: "招募次数", en: "Recruitment limit" },
        min: 0,
        max: 99,
        step: 1,
        description: { zh: "0 表示直到招募许可耗尽。", en: "0 means until permits run out." },
      },
      {
        key: "set_time",
        kind: "switch",
        label: { zh: "设置招募时长", en: "Set recruitment time" },
        advanced: true,
      },
      {
        key: "expedite",
        kind: "switch",
        label: { zh: "使用加急许可", en: "Use expedited plans" },
        advanced: true,
      },
      {
        key: "level3_recruitment_permit_reserve",
        kind: "number",
        label: { zh: "保留三星招募许可", en: "Reserve permits for 3★" },
        min: 0,
        max: 99,
        step: 1,
        advanced: true,
      },
    ],
  },
  Infrast: {
    type: "Infrast",
    name: { zh: "基建换班", en: "Infrastructure" },
    description: {
      zh: "按心情阈值自动换班、使用无人机并处理会客室。",
      en: "Rotate operators by morale, use drones and handle the reception room.",
    },
    icon: "building",
    fields: [
      {
        key: "mode",
        kind: "select",
        label: { zh: "换班模式", en: "Shift mode" },
        options: [
          { value: 0, label: { zh: "默认（自动排班）", en: "Default (automatic)" } },
          { value: 20000, label: { zh: "一键轮换", en: "One-key rotation" } },
        ],
      },
      {
        key: "facility",
        kind: "multi-select",
        label: { zh: "换班设施", en: "Facilities" },
        options: [
          { value: "Mfg", label: { zh: "制造站", en: "Factory" } },
          { value: "Trade", label: { zh: "贸易站", en: "Trading post" } },
          { value: "Power", label: { zh: "发电站", en: "Power plant" } },
          { value: "Control", label: { zh: "控制中枢", en: "Control center" } },
          { value: "Reception", label: { zh: "会客室", en: "Reception room" } },
          { value: "Office", label: { zh: "办公室", en: "Office" } },
          { value: "Recycle", label: { zh: "回收站", en: "Recycling station" } },
          { value: "Dorm", label: { zh: "宿舍", en: "Dormitory" } },
          { value: "Processing", label: { zh: "加工站", en: "Workshop" } },
          { value: "Training", label: { zh: "训练室", en: "Training room" } },
          { value: "AssistantChange", label: { zh: "副手轮换", en: "Assistant rotation" } },
        ],
      },
      {
        key: "drones",
        kind: "select",
        label: { zh: "无人机用途", en: "Drone usage" },
        options: [
          { value: "_NotUse", label: { zh: "不使用", en: "Do not use" } },
          { value: "Money", label: { zh: "龙门币", en: "LMD" } },
          { value: "SyntheticJade", label: { zh: "合成玉", en: "Orundum" } },
          { value: "CombatRecord", label: { zh: "作战记录", en: "Battle records" } },
          { value: "PureGold", label: { zh: "赤金", en: "Pure gold" } },
          { value: "OriginStone", label: { zh: "源石碎片", en: "Originium shards" } },
          { value: "Chip", label: { zh: "芯片", en: "Chips" } },
        ],
      },
      {
        key: "threshold",
        kind: "number",
        label: { zh: "心情阈值", en: "Morale threshold" },
        min: 0,
        max: 1,
        step: 0.05,
        description: {
          zh: "低于该心情比例的干员会被替换。",
          en: "Operators below this morale ratio are rotated out.",
        },
      },
      {
        key: "replenish",
        kind: "switch",
        label: { zh: "补充源石碎片", en: "Replenish Originium shards" },
      },
      {
        key: "reception_message_board",
        kind: "switch",
        label: { zh: "领取会客室信用", en: "Collect reception credits" },
      },
      {
        key: "reception_clue_exchange",
        kind: "switch",
        label: { zh: "交换线索", en: "Exchange clues" },
      },
      {
        key: "reception_send_clue",
        kind: "switch",
        label: { zh: "赠送线索", en: "Send clues" },
      },
      {
        key: "dorm_notstationed_enabled",
        kind: "switch",
        label: { zh: "宿舍优先未进驻干员", en: "Prioritise unstationed operators" },
        advanced: true,
      },
      {
        key: "dorm_trust_enabled",
        kind: "switch",
        label: { zh: "宿舍填充未满信赖干员", en: "Fill dorms with low-trust operators" },
        advanced: true,
      },
      {
        key: "continue_training",
        kind: "switch",
        label: { zh: "继续技能训练", en: "Continue skill training" },
        advanced: true,
      },
      {
        key: "use_pinus_sylvestris",
        kind: "switch",
        label: { zh: "松烟行动小队", en: "Pinus Sylvestris squad" },
        advanced: true,
      },
      {
        key: "use_perception_information",
        kind: "switch",
        label: { zh: "感知信息小队", en: "Perception Information squad" },
        advanced: true,
      },
      {
        key: "use_worldly_plight",
        kind: "switch",
        label: { zh: "人间烟火小队", en: "Worldly Plight squad" },
        advanced: true,
      },
      {
        key: "use_abyssal_hunter",
        kind: "switch",
        label: { zh: "深海猎人小队", en: "Abyssal Hunters squad" },
        advanced: true,
      },
      {
        key: "fiammetta_recovery_enabled",
        kind: "switch",
        label: { zh: "菲亚梅塔恢复心情", en: "Fiammetta morale recovery" },
        advanced: true,
      },
    ],
  },
  Mall: {
    type: "Mall",
    name: { zh: "领取信用及购物", en: "Credit Store" },
    description: {
      zh: "访问好友、领取信用并自动购买信用商店物品。",
      en: "Visit friends, collect credits and buy from the credit store.",
    },
    icon: "shopping-bag",
    fields: [
      { key: "visit_friends", kind: "switch", label: { zh: "访问好友", en: "Visit friends" } },
      { key: "shopping", kind: "switch", label: { zh: "购买物品", en: "Buy items" } },
      {
        key: "buy_first",
        kind: "tags",
        label: { zh: "优先购买", en: "Buy first" },
        placeholder: { zh: "招聘许可, 龙门币", en: "Recruitment Permit, LMD" },
        description: {
          zh: "用逗号分隔物品名称，优先购买这些物品。",
          en: "Comma-separated item names to purchase first.",
        },
      },
      {
        key: "blacklist",
        kind: "tags",
        label: { zh: "黑名单", en: "Blacklist" },
        placeholder: { zh: "加急许可, 家具零件", en: "Expedited Plan, Furniture Part" },
        description: { zh: "用逗号分隔不购买的物品。", en: "Comma-separated items to skip." },
      },
      {
        key: "force_shopping_if_credit_full",
        kind: "switch",
        label: { zh: "信用溢出时忽略黑名单", en: "Ignore blacklist when credits overflow" },
        advanced: true,
      },
      {
        key: "only_buy_discount",
        kind: "switch",
        label: { zh: "只购买折扣物品", en: "Only buy discounted items" },
        advanced: true,
      },
      {
        key: "reserve_max_credit",
        kind: "switch",
        label: { zh: "保留 300 信用", en: "Reserve 300 credits" },
        advanced: true,
      },
      {
        key: "credit_fight",
        kind: "switch",
        label: { zh: "OF-1 信用作战", en: "OF-1 credit battle" },
        advanced: true,
      },
      {
        key: "formation_index",
        kind: "number",
        label: { zh: "编队栏位", en: "Formation slot" },
        min: 0,
        max: 5,
        step: 1,
        advanced: true,
      },
    ],
  },
  Award: {
    type: "Award",
    name: { zh: "领取奖励", en: "Rewards" },
    description: {
      zh: "一键领取日常、邮件、免费单抽与活动奖励。",
      en: "Collect daily, mail, free pull and event rewards in one pass.",
    },
    icon: "gift",
    fields: [
      { key: "award", kind: "switch", label: { zh: "日常/周常奖励", en: "Daily/weekly rewards" } },
      { key: "mail", kind: "switch", label: { zh: "邮件", en: "Mail" } },
      { key: "recruit", kind: "switch", label: { zh: "免费单抽", en: "Free pulls" } },
      { key: "orundum", kind: "switch", label: { zh: "幸运墙合成玉", en: "Lucky drop Orundum" } },
      { key: "mining", kind: "switch", label: { zh: "挖矿合成玉", en: "Mining Orundum" } },
      {
        key: "specialaccess",
        kind: "switch",
        label: { zh: "月卡奖励", en: "Monthly card rewards" },
      },
    ],
  },
  Roguelike: {
    type: "Roguelike",
    name: { zh: "集成战略", en: "Integrated Strategies" },
    description: {
      zh: "自动刷取肉鸽分数、源石锭或主题奖励，支持六个主题、开局凹奖励与黑流树海刷开局。",
      en: "Farm Integrated Strategies score, ingots or theme rewards across all six themes, including opening resets and Blackflow starting-reward runs.",
    },
    icon: "compass",
    fields: [
      { key: "theme", kind: "select", label: { zh: "主题", en: "Theme" }, options: ROGUELIKE_THEME_OPTIONS },
      {
        key: "mode",
        kind: "select",
        label: { zh: "模式", en: "Mode" },
        options: (params) => roguelikeModeOptions(paramString(params, "theme")),
      },
      {
        key: "difficulty",
        kind: "select",
        label: { zh: "难度等级", en: "Difficulty" },
        description: {
          zh: "不切换表示沿用游戏内当前难度；最高为该主题已解锁的最高难度。",
          en: "Don't switch keeps the current in-game difficulty; Max uses the highest unlocked one.",
        },
        options: (params) => roguelikeDifficultyOptions(paramString(params, "theme")),
      },
      {
        key: "squad",
        kind: "text",
        label: { zh: "分队", en: "Squad" },
        placeholder: { zh: "指挥分队", en: "指挥分队" },
        description: {
          zh: "游戏内中文分队名，例如指挥分队、特勤分队、点刺成锭分队。",
          en: "Use the in-game Chinese squad name.",
        },
      },
      {
        key: "roles",
        kind: "select",
        label: { zh: "职业组", en: "Role group" },
        options: (params) => roguelikeRoleOptions(paramString(params, "theme"), params.roles),
      },
      {
        key: "core_char_list",
        kind: "opers",
        label: { zh: "开局干员", en: "Starting operators" },
        description: {
          zh: "按开局免费招募的顺位填写，最多 3 个；每个位置可单独设为助战。三个位置的职业不能相同。",
          en: "Filled in recruit order, up to three; each slot can use a support operator. The three classes must differ.",
        },
      },
      {
        key: "starts_count",
        kind: "number",
        label: { zh: "探索次数", en: "Explorations" },
        min: 0,
        max: 9999,
        step: 1,
        description: { zh: "达到次数后停止，0 表示不限。", en: "Stop after this many runs. 0 means unlimited." },
      },
      { key: "investment_enabled", kind: "switch", label: { zh: "投资源石锭", en: "Invest ingots" } },
      {
        key: "investments_count",
        kind: "number",
        label: { zh: "投资次数", en: "Investments" },
        min: 0,
        max: 999,
        step: 1,
        description: {
          zh: "达到次数后停止，0 表示不限。",
          en: "Stop after this many investments. 0 means unlimited.",
        },
        visibleWhen: (params) => paramFlag(params, "investment_enabled"),
      },
      {
        key: "stop_when_investment_full",
        kind: "switch",
        label: { zh: "投资满后停止", en: "Stop when investment is full" },
        advanced: true,
        visibleWhen: (params) => paramFlag(params, "investment_enabled") && paramNumber(params, "mode") === 1,
      },
      {
        key: "investment_with_more_score",
        kind: "switch",
        label: { zh: "投资后继续购物", en: "Shop after investing" },
        description: { zh: "仅适用于刷源石锭模式。", en: "Only used by the Originium Ingot farming mode." },
        advanced: true,
        visibleWhen: (params) =>
          paramFlag(params, "investment_enabled") &&
          paramNumber(params, "mode") === 1 &&
          paramString(params, "theme") !== "BlackFlow",
      },
      {
        key: "stop_at_final_boss",
        kind: "switch",
        label: { zh: "最终 Boss 前停止", en: "Stop before the final boss" },
        description: {
          zh: "仅适用于刷等级模式，且不适用于傀影主题。",
          en: "Only in the level mode, and not in Phantom.",
        },
        advanced: true,
        visibleWhen: (params) => paramNumber(params, "mode") === 0 && paramString(params, "theme") !== "Phantom",
      },
      {
        key: "stop_at_max_level",
        kind: "switch",
        label: { zh: "等级刷满后停止", en: "Stop at max level" },
        advanced: true,
        visibleWhen: (params) => paramNumber(params, "mode") === 0,
      },
      {
        key: "start_with_elite_two",
        kind: "switch",
        label: { zh: "凹精二直升", en: "Reset for an Elite 2 start" },
        advanced: true,
        visibleWhen: (params) => paramNumber(params, "mode") === 4,
      },
      {
        key: "only_start_with_elite_two",
        kind: "switch",
        label: { zh: "只要求精二直升", en: "Only require the Elite 2 start" },
        advanced: true,
        visibleWhen: (params) => paramNumber(params, "mode") === 4 && paramFlag(params, "start_with_elite_two"),
      },
      {
        key: "collectible_mode_start_list",
        kind: "multi-select",
        label: { zh: "开局奖励", en: "Starting rewards" },
        description: {
          zh: "凹开局时期望的奖励，全部留空则沿用核心默认值。",
          en: "Rewards to look for during opening reset. Leave empty for the core defaults.",
        },
        options: (params) => collectibleRewardOptions(paramString(params, "theme")),
        advanced: true,
        visibleWhen: (params) => paramNumber(params, "mode") === 4,
      },
      {
        key: "collectible_mode_squad",
        kind: "text",
        label: { zh: "凹开局分队", en: "Reset squad" },
        placeholder: { zh: "留空则与分队相同", en: "Empty uses the squad above" },
        description: {
          zh: "刷开局（含黑流树海准备局）时使用的分队。",
          en: "Squad used by the opening-reset run, including the Blackflow preparation run.",
        },
        advanced: true,
        visibleWhen: (params) => paramNumber(params, "mode") === 4 || paramNumber(params, "mode") === 30003,
      },
      {
        key: "collectible_mode_shopping",
        kind: "switch",
        label: { zh: "凹开局购物", en: "Shop during opening reset" },
        advanced: true,
        visibleWhen: (params) => paramNumber(params, "mode") === 4,
      },
      {
        key: "first_floor_foldartal",
        kind: "text",
        label: { zh: "第一层密文板", en: "First-floor Foldartal" },
        placeholder: { zh: "填写密文板名称", en: "Foldartal name" },
        description: { zh: "仅适用于萨米主题；凹到后停止任务。", en: "Sami only; stops once it appears." },
        advanced: true,
        visibleWhen: (params) => paramString(params, "theme") === "Sami",
      },
      {
        key: "start_foldartal_list",
        kind: "tags",
        label: { zh: "开局密文板", en: "Starting Foldartals" },
        placeholder: { zh: "例如 迁徙, 捕猎", en: "e.g. 迁徙, 捕猎" },
        description: {
          zh: "用逗号分隔的密文板名，全部到手才算凹开局成功；需配合生活至上分队。仅适用于萨米主题的刷开局模式。",
          en: "Comma-separated Foldartal names. Sami opening reset only; pair it with the 生活至上分队 squad.",
        },
        advanced: true,
        visibleWhen: (params) => paramString(params, "theme") === "Sami" && paramNumber(params, "mode") === 4,
      },
      {
        key: "expected_collapsal_paradigms",
        kind: "tags",
        label: { zh: "期望坍缩范式", en: "Expected Collapsal Paradigms" },
        placeholder: { zh: "目空一些, 睁眼瞎", en: "目空一些, 睁眼瞎" },
        description: {
          zh: "用逗号分隔的中文范式名；仅在萨米主题的刷坍缩范式模式下生效。",
          en: "Comma-separated Chinese paradigm names. Sami + Collapsal Paradigm mode only.",
        },
        advanced: true,
        visibleWhen: (params) => paramString(params, "theme") === "Sami" && paramNumber(params, "mode") === 5,
      },
      {
        key: "refresh_trader_with_dice",
        kind: "switch",
        label: { zh: "用骰子刷新商店", en: "Refresh the shop with dice" },
        description: { zh: "仅适用于水月主题，用于刷指路鳞。", en: "Mizuki only, used to farm the guided scale." },
        advanced: true,
        visibleWhen: (params) => paramString(params, "theme") === "Mizuki",
      },
      {
        key: "monthly_squad_auto_iterate",
        kind: "switch",
        label: { zh: "自动切换月度小队", en: "Auto-iterate monthly squads" },
        advanced: true,
        visibleWhen: (params) => paramNumber(params, "mode") === 6,
      },
      {
        key: "monthly_squad_check_comms",
        kind: "switch",
        label: { zh: "按通信判断切换", en: "Check communications" },
        advanced: true,
        visibleWhen: (params) => paramNumber(params, "mode") === 6 && paramFlag(params, "monthly_squad_auto_iterate"),
      },
      {
        key: "deep_exploration_auto_iterate",
        kind: "switch",
        label: { zh: "自动切换深入调查", en: "Auto-iterate deep exploration" },
        advanced: true,
        visibleWhen: (params) => paramNumber(params, "mode") === 7,
      },
      {
        key: "use_nonfriend_support",
        kind: "switch",
        label: { zh: "允许非好友助战", en: "Allow non-friend support" },
        advanced: true,
      },
      {
        key: "start_with_seed",
        kind: "text",
        label: { zh: "指定种子", en: "Start with seed" },
        placeholder: { zh: "例如 2b3c4d,rogue_1,120", en: "e.g. 2b3c4d,rogue_1,120" },
        description: {
          zh: "留空则不启用；界园主题与萨卡兹主题刷源石锭（点刺成锭 / 后勤分队）时生效。",
          en: "Leave empty to disable. JieGarden, and Sarkaz ingot farming with 点刺成锭 / 后勤分队.",
        },
        advanced: true,
        visibleWhen: (params) =>
          paramString(params, "theme") === "JieGarden" ||
          (paramString(params, "theme") === "Sarkaz" && paramNumber(params, "mode") === 1),
      },
      {
        key: "find_playTime_target",
        kind: "select",
        label: { zh: "目标常乐节点", en: "Playtime node" },
        description: { zh: "仅适用于界园的刷常乐节点模式。", en: "JieGarden Playtime farming only." },
        options: [
          { value: 1, label: { zh: "令 · 掷地有声", en: "Ling · Resounding Words" } },
          { value: 2, label: { zh: "黍 · 种因得果", en: "Shu · Reap What You Sow" } },
          { value: 3, label: { zh: "年 · 三缺一", en: "Nian · Mahjong Trio" } },
        ],
        visibleWhen: (params) => paramString(params, "theme") === "JieGarden" && paramNumber(params, "mode") === 20001,
      },
      {
        key: "blackflow_fast_flight",
        kind: "switch",
        label: { zh: "快速飞三层", en: "Fly to Floor 3 quickly" },
        description: {
          zh: "刷等级时固定用特勤分队、稳扎稳打和满天赋机械师开局，第二层飞到第三层后重开；机械师天赋没点满不要勾选。",
          en: "Fixes the start to Special Squad, Slow and Steady and a fully talented Mechanic, then flies to Floor 3 and restarts. Do not enable without a fully talented Mechanic.",
        },
        visibleWhen: (params) => paramString(params, "theme") === "BlackFlow" && paramNumber(params, "mode") === 0,
      },
      {
        key: "blackflow_animal_1",
        kind: "select",
        label: { zh: "襁褓动物 · 第一只", en: "Swaddled animal · 1st" },
        options: (params) => blackflowAnimalOptions(params.blackflow_animal_2),
        visibleWhen: (params) => paramString(params, "theme") === "BlackFlow" && paramNumber(params, "mode") === 30003,
      },
      {
        key: "blackflow_animal_2",
        kind: "select",
        label: { zh: "襁褓动物 · 第二只", en: "Swaddled animal · 2nd" },
        options: (params) => blackflowAnimalOptions(params.blackflow_animal_1),
        visibleWhen: (params) => paramString(params, "theme") === "BlackFlow" && paramNumber(params, "mode") === 30003,
      },
      {
        key: "blackflow_start_rewards",
        kind: "multi-select",
        label: { zh: "期望的开局奖励", en: "Desired rewards" },
        description: {
          zh: "命中任意一项即可，退出后保留这一局；羽蛇奖励只在选择羽蛇时生效。",
          en: "Any hit completes the run and keeps it; Feathered Serpent rewards only count with a serpent.",
        },
        options: (params) => blackflowRewardOptions(hasBlackflowSerpent(params)),
        visibleWhen: (params) => paramString(params, "theme") === "BlackFlow" && paramNumber(params, "mode") === 30003,
      },
      {
        key: "blackflow_start_utopia",
        kind: "switch",
        label: { zh: "凹第一层实托邦", en: "Reroll until Floor 1 is Utopia" },
        description: {
          zh: "命中奖励后按优先级选卡并进入第一层，第一层是实托邦才保留这一局；需要难度 6 以上。",
          en: "Picks cards by priority and enters Floor 1; keeps the run only if Floor 1 has Utopia. Requires difficulty 6+.",
        },
        visibleWhen: (params) => paramString(params, "theme") === "BlackFlow" && paramNumber(params, "mode") === 30003,
      },
      {
        key: "blackflow_start_reward_priority",
        kind: "multi-select",
        label: { zh: "开局奖励优先级", en: "Reward pick priority" },
        description: {
          zh: "按选择顺序优先；留空则使用推荐顺序。凹实托邦时生效。",
          en: "Earlier picks win; empty uses the recommended order. Utopia only.",
        },
        options: blackflowRewardPriorityOptions(),
        visibleWhen: (params) =>
          paramString(params, "theme") === "BlackFlow" &&
          paramNumber(params, "mode") === 30003 &&
          paramFlag(params, "blackflow_start_utopia"),
      },
      {
        key: "blackflow_start_run_fast_flight",
        kind: "switch",
        label: { zh: "准备局快速飞三层", en: "Fly preparation runs to Floor 3" },
        description: {
          zh: "准备局固定用特勤分队、稳扎稳打和满天赋机械师开局；目标局仍用上面的常规设置。机械师天赋没点满不要勾选。",
          en: "Preparation runs fix Special Squad, Slow and Steady and a fully talented Mechanic; the target run keeps the normal settings.",
        },
        advanced: true,
        visibleWhen: (params) => paramString(params, "theme") === "BlackFlow" && paramNumber(params, "mode") === 30003,
      },
    ],
  },

  Reclamation: {
    type: "Reclamation",
    name: { zh: "生息演算", en: "Reclamation" },
    description: {
      zh: "自动刷取生息演算的建造点与货币，可指定主题、制造物品与点击方式。",
      en: "Farm Reclamation Algorithm badges, construction points and currency with automatic crafting.",
    },
    icon: "wrench",
    fields: [
      {
        key: "theme",
        kind: "select",
        label: { zh: "主题", en: "Theme" },
        options: [
          { value: "Fire", label: { zh: "沙中之火", en: "Fire Within the Sand" } },
          { value: "Tales", label: { zh: "沙洲遗闻", en: "Tales Within the Sand" } },
        ],
      },
      {
        key: "mode",
        kind: "select",
        label: { zh: "模式", en: "Mode" },
        options: [
          { value: 0, label: { zh: "刷分与建造点", en: "Badges & construction points" } },
          { value: 1, label: { zh: "刷赤金与制造物品", en: "Gold & crafting" } },
        ],
      },
      {
        key: "tools_to_craft",
        kind: "tags",
        label: { zh: "自动制造", en: "Craft items" },
        placeholder: { zh: "荧光棒, 发电机", en: "荧光棒, 发电机" },
        description: {
          zh: "用逗号分隔的中文物品名，可填写子串。",
          en: "Comma-separated Chinese item names or substrings.",
        },
        visibleWhen: (params) => paramNumber(params, "mode") === 1,
      },
      {
        key: "increment_mode",
        kind: "select",
        label: { zh: "点击方式", en: "Click mode" },
        options: [
          { value: 0, label: { zh: "连点", en: "Rapid click" } },
          { value: 1, label: { zh: "长按", en: "Long press" } },
        ],
        advanced: true,
        visibleWhen: (params) => paramNumber(params, "mode") === 1,
      },
      {
        key: "num_craft_batches",
        kind: "number",
        label: { zh: "制造轮数上限", en: "Craft batches" },
        min: 1,
        max: 99,
        step: 1,
        advanced: true,
        visibleWhen: (params) => paramNumber(params, "mode") === 1,
      },
    ],
  },
  Copilot: {
    type: "Copilot",
    name: { zh: "自动战斗", en: "Auto Battle" },
    description: {
      zh: "按作业文件自动组队并战斗，支持普通关卡、剿灭与活动关卡。",
      en: "Follow a copilot file: build the squad automatically and clear the stage.",
    },
    icon: "swords",
    fields: [
      {
        key: "filename",
        kind: "file",
        label: { zh: "本地作业文件", en: "Local copilot file" },
        description: {
          zh: "也可以直接导入一个 JSON 文件；上面的作业列表优先。",
          en: "You can also import a JSON file; the assignment list above takes precedence.",
        },
        required: true,
        visibleWhen: (params) => !hasCopilotList(params),
        satisfies: (params) =>
          hasCopilotList(params) || (typeof params.filename === "string" && (params.filename as string).trim() !== ""),
      },
      {
        key: "formation",
        kind: "switch",
        label: { zh: "自动编队", en: "Auto formation" },
        description: { zh: "按作业要求自动选择干员与技能。", en: "Pick operators and skills as the file requires." },
      },
      {
        key: "add_trust",
        kind: "switch",
        label: { zh: "填充信赖干员", en: "Fill with trust operators" },
        description: {
          zh: "空余位置自动补充需要刷信赖的干员。",
          en: "Fill empty slots with operators that need trust.",
        },
      },
      {
        key: "ignore_requirements",
        kind: "switch",
        label: { zh: "忽略练度要求", en: "Ignore level requirements" },
        description: {
          zh: "干员练度不足时仍然尝试执行，可能失败。",
          en: "Run even when operators are below the required level; it may fail.",
        },
        advanced: true,
      },
      {
        key: "use_sanity_potion",
        kind: "switch",
        label: { zh: "使用理智药", en: "Use sanity potions" },
        advanced: true,
      },
      {
        key: "support_unit_usage",
        kind: "select",
        label: { zh: "助战干员", en: "Support unit" },
        options: [
          { value: 0, label: { zh: "不使用", en: "Do not use" } },
          { value: 1, label: { zh: "需要时使用", en: "When required" } },
          { value: 2, label: { zh: "仅助战", en: "Support only" } },
          { value: 3, label: { zh: "随机助战", en: "Random support" } },
        ],
        advanced: true,
      },
      {
        key: "loop_times",
        kind: "number",
        label: { zh: "循环次数", en: "Loop count" },
        min: 1,
        max: 99,
        step: 1,
        advanced: true,
      },
      {
        key: "formation_index",
        kind: "number",
        label: { zh: "指定编队", en: "Formation slot" },
        min: 0,
        max: 4,
        step: 1,
        description: {
          zh: "0 表示不指定，1–4 对应游戏内编队栏位。",
          en: "0 lets the copilot choose; 1-4 pins a slot.",
        },
        advanced: true,
      },
    ],
  },
  SSSCopilot: {
    type: "SSSCopilot",
    name: { zh: "保全派驻", en: "SSS Copilot" },
    description: {
      zh: "按作业文件完成保全派驻，可重复刷取。",
      en: "Clear Stationary Security Service from a copilot file, optionally on repeat.",
    },
    icon: "box",
    fields: [
      {
        key: "filename",
        kind: "file",
        label: { zh: "作业文件", en: "Copilot file" },
        required: true,
      },
      {
        key: "formation",
        kind: "switch",
        label: { zh: "自动编队", en: "Auto formation" },
      },
      {
        key: "loop_times",
        kind: "number",
        label: { zh: "循环次数", en: "Loop count" },
        min: 1,
        max: 99,
        step: 1,
      },
      {
        key: "use_sanity_potion",
        kind: "switch",
        label: { zh: "使用理智药", en: "Use sanity potions" },
        advanced: true,
      },
      {
        key: "support_unit_usage",
        kind: "select",
        label: { zh: "助战干员", en: "Support unit" },
        options: [
          { value: 0, label: { zh: "不使用", en: "Do not use" } },
          { value: 1, label: { zh: "需要时使用", en: "When required" } },
          { value: 2, label: { zh: "仅助战", en: "Support only" } },
          { value: 3, label: { zh: "随机助战", en: "Random support" } },
        ],
        advanced: true,
      },
    ],
  },
  ParadoxCopilot: {
    type: "ParadoxCopilot",
    name: { zh: "悖论模拟", en: "Paradox Simulation" },
    description: {
      zh: "按作业文件完成干员悖论模拟。",
      en: "Clear an operator's Paradox Simulation from a copilot file.",
    },
    icon: "compass",
    fields: [
      {
        key: "filename",
        kind: "file",
        label: { zh: "作业文件", en: "Copilot file" },
        required: true,
      },
    ],
  },
  Depot: {
    type: "Depot",
    name: { zh: "仓库识别", en: "Depot Recognition" },
    description: {
      zh: "识别仓库中的材料并生成数据，供一图流等工具使用。",
      en: "Read the depot to produce material data for external tools.",
    },
    icon: "box",
    fields: [],
  },
  OperBox: {
    type: "OperBox",
    name: { zh: "干员识别", en: "Operator Box" },
    description: {
      zh: "识别已拥有干员及练度，可用于作业辅助编队。",
      en: "Read the operator box and their promotion levels.",
    },
    icon: "users",
    fields: [],
  },
  Custom: {
    type: "Custom",
    name: { zh: "自定义任务", en: "Custom Task" },
    description: {
      zh: "执行资源中定义的自定义任务，例如小游戏。",
      en: "Run custom tasks defined by the resource, such as mini games.",
    },
    icon: "terminal",
    fields: [
      {
        key: "task_names",
        kind: "tags",
        label: { zh: "任务名", en: "Task names" },
        placeholder: { zh: "例如 小游戏任务名", en: "e.g. a mini-game task name" },
        description: { zh: "用逗号分隔，按顺序执行。", en: "Comma-separated, executed in order." },
        required: true,
      },
    ],
  },
  SingleStep: {
    type: "SingleStep",
    name: { zh: "单步作战", en: "Single Step" },
    description: {
      zh: "逐步控制一场战斗：设置关卡、开始作战或执行单个部署操作。",
      en: "Drive one battle step by step: set the stage, start it, or perform a single deployment action.",
    },
    icon: "activity",
    fields: [
      {
        key: "subtask",
        kind: "select",
        label: { zh: "步骤", en: "Step" },
        options: [
          { value: "stage", label: { zh: "设置关卡", en: "Set stage" } },
          { value: "start", label: { zh: "开始作战", en: "Start battle" } },
          { value: "action", label: { zh: "单步操作", en: "Single action" } },
        ],
      },
      {
        key: "stage",
        kind: "stage",
        label: { zh: "关卡", en: "Stage" },
        placeholder: { zh: "例如 1-7", en: "e.g. 1-7" },
        required: true,
        visibleWhen: (params) => paramString(params, "subtask") === "stage",
      },
      {
        key: "name",
        kind: "text",
        label: { zh: "干员名", en: "Operator" },
        placeholder: { zh: "中文干员名", en: "Chinese operator name" },
        required: true,
        visibleWhen: (params) => paramString(params, "subtask") === "action",
      },
      {
        key: "location",
        kind: "text",
        label: { zh: "部署位置", en: "Location" },
        placeholder: { zh: "例如 4,5", en: "e.g. 4,5" },
        description: { zh: "填写格子坐标 x,y。", en: "Grid coordinates as x,y." },
        required: true,
        satisfies: (params) => /^\d+\s*,\s*\d+$/u.test(paramString(params, "location")),
        visibleWhen: (params) => paramString(params, "subtask") === "action",
      },
      {
        key: "direction",
        kind: "select",
        label: { zh: "朝向", en: "Direction" },
        options: [
          { value: "右", label: { zh: "右", en: "Right" } },
          { value: "左", label: { zh: "左", en: "Left" } },
          { value: "上", label: { zh: "上", en: "Up" } },
          { value: "下", label: { zh: "下", en: "Down" } },
        ],
        visibleWhen: (params) => paramString(params, "subtask") === "action",
      },
      {
        key: "skill",
        kind: "number",
        label: { zh: "技能", en: "Skill" },
        min: 0,
        max: 3,
        step: 1,
        description: { zh: "0 表示沿用游戏内默认技能。", en: "0 keeps the game's default skill." },
        visibleWhen: (params) => paramString(params, "subtask") === "action",
      },
    ],
  },
  VideoRecognition: {
    type: "VideoRecognition",
    name: { zh: "视频识别", en: "Video Recognition" },
    description: {
      zh: "解析作战录像并输出识别结果，用于生成作业。",
      en: "Recognise operations from a battle recording and report the result.",
    },
    icon: "camera",
    fields: [
      {
        key: "filename",
        kind: "file",
        accept: "video",
        label: { zh: "作战录像", en: "Battle recording" },
        placeholder: { zh: "选择视频文件", en: "Choose a video file" },
        required: true,
      },
    ],
  },
  CloseDown: {
    type: "CloseDown",
    name: { zh: "关闭游戏", en: "Close Game" },
    description: {
      zh: "结束任务后关闭明日方舟客户端。",
      en: "Close the Arknights client after the queue finishes.",
    },
    icon: "power-off",
    fields: [],
  },
};

/** Default queue created for a new plan. */
export const TASK_TYPE_ORDER: ReadonlyArray<TaskType> = [
  "StartUp",
  "Fight",
  "Recruit",
  "Infrast",
  "Mall",
  "Award",
  "CloseDown",
];

/**
 * Everything the add-task palette offers, daily tasks first.
 *
 * `Copilot` is deliberately absent: clearing a stage for the first time is a
 * one-off action, so it has its own tab instead of sitting in the daily queue.
 */
export const TASK_PALETTE_ORDER: ReadonlyArray<TaskType> = [
  "StartUp",
  "Fight",
  "Recruit",
  "Infrast",
  "Mall",
  "Award",
  "Roguelike",
  "Reclamation",
  "SSSCopilot",
  "ParadoxCopilot",
  "Depot",
  "OperBox",
  "Custom",
  "SingleStep",
  "VideoRecognition",
  "CloseDown",
];

/**
 * A copilot task can carry a batch of assignments instead of one file.
 *
 * Rows with neither difficulty checked are skipped, so a list made only of
 * skipped rows needs a local file just like an empty one.
 */
export const hasCopilotList = (params: Record<string, unknown>): boolean =>
  copilotItemEntries(readCopilotBatch(params.copilot_list)).length > 0;

export function getTaskDefaults(type: TaskType): Record<string, unknown> {
  switch (type) {
    case "StartUp":
      return { start_game_enabled: true, account_name: "" };
    case "Fight":
      return {
        stage: "",
        medicine: 0,
        medicine_expire_days: 0,
        stone: 0,
        times: 0,
        series: 0,
        DrGrandet: false,
      };
    case "Recruit":
      return {
        select: [4, 5],
        confirm: [3, 4, 5],
        refresh: false,
        times: 0,
        set_time: true,
        expedite: false,
        level3_recruitment_permit_reserve: 0,
      };
    case "Infrast":
      return {
        mode: 0,
        facility: [
          "Mfg",
          "Trade",
          "Power",
          "Control",
          "Reception",
          "Office",
          "Recycle",
          "Dorm",
          "Processing",
          "Training",
        ],
        drones: "_NotUse",
        threshold: 0.3,
        replenish: false,
        dorm_notstationed_enabled: false,
        dorm_trust_enabled: false,
        reception_message_board: true,
        reception_clue_exchange: true,
        reception_send_clue: true,
        continue_training: false,
        use_pinus_sylvestris: false,
        use_perception_information: false,
        use_worldly_plight: false,
        use_abyssal_hunter: false,
        fiammetta_recovery_enabled: false,
      };
    case "Mall":
      return {
        visit_friends: true,
        shopping: true,
        buy_first: [],
        blacklist: [],
        force_shopping_if_credit_full: false,
        only_buy_discount: false,
        reserve_max_credit: false,
        credit_fight: false,
        formation_index: 0,
      };
    case "Award":
      return {
        award: true,
        mail: false,
        recruit: false,
        orundum: false,
        mining: false,
        specialaccess: false,
      };
    case "Roguelike":
      return {
        theme: "Phantom",
        mode: 0,
        difficulty: ROGUELIKE_MAX_DIFFICULTY_VALUE,
        squad: "指挥分队",
        roles: "取长补短",
        core_char_list: [],
        starts_count: 0,
        investment_enabled: true,
        investments_count: 0,
        stop_when_investment_full: false,
        investment_with_more_score: false,
        stop_at_final_boss: false,
        stop_at_max_level: false,
        start_with_elite_two: false,
        only_start_with_elite_two: false,
        collectible_mode_start_list: [],
        collectible_mode_squad: "",
        collectible_mode_shopping: false,
        first_floor_foldartal: "",
        start_foldartal_list: [],
        expected_collapsal_paradigms: ["目空一些", "睁眼瞎", "图像损坏", "一抹黑"],
        refresh_trader_with_dice: false,
        monthly_squad_auto_iterate: false,
        monthly_squad_check_comms: false,
        deep_exploration_auto_iterate: false,
        use_nonfriend_support: false,
        start_with_seed: "",
        find_playTime_target: 1,
        blackflow_fast_flight: false,
        blackflow_animal_1: "",
        blackflow_animal_2: "",
        blackflow_start_rewards: [],
        blackflow_start_utopia: false,
        blackflow_start_reward_priority: [],
        blackflow_start_run_fast_flight: false,
      };
    case "Reclamation":
      return {
        theme: "Fire",
        mode: 0,
        tools_to_craft: ["荧光棒"],
        increment_mode: 0,
        num_craft_batches: 16,
      };
    case "Copilot":
      return {
        copilot_list: [],
        filename: "",
        formation: true,
        add_trust: false,
        ignore_requirements: false,
        use_sanity_potion: false,
        support_unit_usage: 0,
        loop_times: 1,
        formation_index: 0,
      };
    case "SSSCopilot":
      return {
        filename: "",
        formation: true,
        loop_times: 1,
        use_sanity_potion: false,
        support_unit_usage: 0,
      };
    case "ParadoxCopilot":
      return { filename: "" };
    case "Depot":
    case "OperBox":
      return {};
    case "Custom":
      return { task_names: [] };
    case "SingleStep":
      return { subtask: "stage", stage: "", name: "", location: "", direction: "右", skill: 0 };
    case "VideoRecognition":
      return { filename: "" };
    case "CloseDown":
      return {};
  }
}

export function taskDisplayName(type: TaskType, customName = ""): LocalizedText {
  return customName.trim() === "" ? TASK_DEFINITIONS[type].name : { zh: customName, en: customName };
}

/** Parse "x,y" into the copilot action tuple; malformed input is rejected in `firstMissingField`. */
const parseLocation = (value: string): [number, number] => {
  const [x = "", y = ""] = value.split(",");
  const location: [number, number] = [Number(x.trim()), Number(y.trim())];
  return location.every((part) => Number.isInteger(part) && part >= 0) ? location : [0, 0];
};

const BLACKFLOW_FLIGHT_SQUAD = "特勤分队";
const BLACKFLOW_FLIGHT_ROLES = "稳扎稳打";
const BLACKFLOW_FLIGHT_CORE_CHAR = "机械师";

/** The two requirement slots in order; the core rejects more than one feathered serpent. */
const blackflowAnimals = (first: unknown, second: unknown): ReadonlyArray<string> => {
  const allowed = BLACKFLOW_ANIMAL_OPTIONS.map((option) => String(option.value));
  let serpent = false;
  return [first, second].flatMap((slot) => {
    if (typeof slot !== "string" || !allowed.includes(slot)) return [];
    if (slot === BLACKFLOW_SERPENT) {
      if (serpent) return [];
      serpent = true;
    }
    return [slot];
  });
};

/**
 * MaaCore's Roguelike task is theme-driven: one key can reject the whole
 * parameter set in a theme (`start_with_elite_two` outside mode 4, an empty
 * `start_foldartal_list`, Blackflow's mandatory start-run fields) and be ignored
 * in another. Build the payload from the current theme and mode instead of
 * forwarding every stored key, so a plan switched between themes does not carry
 * a stale combination.
 */
function buildRoguelikeParams(taskParams: Record<string, unknown>, settings: AppSettings): Record<string, unknown> {
  const theme = normalizeRoguelikeTheme(paramString(taskParams, "theme"));
  const mode = roguelikeModeFor(theme, paramNumber(taskParams, "mode"));
  const params: Record<string, unknown> = {
    enable: true,
    client_type: settings.clientType,
    theme,
    mode,
    // A stored plan always has it; an imported one without it keeps the core's "don't switch".
    difficulty: roguelikeDifficultyValue(theme, typeof taskParams.difficulty === "number" ? taskParams.difficulty : -1),
  };

  // 满天赋机械师：刷等级与刷开局的准备局都固定这一套开局组合。
  const flight = theme === "BlackFlow" && mode === 0 && paramFlag(taskParams, "blackflow_fast_flight");
  const prepFlight =
    theme === "BlackFlow" && mode === 30003 && paramFlag(taskParams, "blackflow_start_run_fast_flight");
  const squad = flight ? BLACKFLOW_FLIGHT_SQUAD : paramString(taskParams, "squad").trim();
  const roles = flight ? BLACKFLOW_FLIGHT_ROLES : paramString(taskParams, "roles").trim();
  if (squad !== "") params.squad = squad;
  if (roles !== "") params.roles = roles;

  // A written list wins over the legacy single operator; MaaCore only falls back
  // to `core_char` while `core_char_list` is absent.
  const startOpers = readStartingOpers(taskParams.core_char_list)
    .slice(0, ROGUELIKE_STARTING_OPERS)
    .filter((oper) => oper.name.trim() !== "");
  if (flight || startOpers.length > 0) {
    const list = flight ? [{ name: BLACKFLOW_FLIGHT_CORE_CHAR, useSupport: false }] : startOpers;
    params.core_char_list = list.map((oper) => ({ name: oper.name.trim(), use_support: oper.useSupport }));
  } else {
    const legacy = paramString(taskParams, "core_char").trim();
    if (legacy !== "") {
      params.core_char = legacy;
      params.use_support = paramFlag(taskParams, "use_support");
    }
  }

  const starts = paramNumber(taskParams, "starts_count");
  if (starts > 0) params.starts_count = starts;

  // The core defaults investment to on; only an explicit false turns it off.
  const invest = taskParams.investment_enabled !== false;
  params.investment_enabled = invest;
  params.use_nonfriend_support = paramFlag(taskParams, "use_nonfriend_support");
  if (invest) {
    const investments = paramNumber(taskParams, "investments_count");
    if (investments > 0) params.investments_count = investments;
    params.stop_when_investment_full = paramFlag(taskParams, "stop_when_investment_full");
    if (mode === 1 && theme !== "BlackFlow") {
      params.investment_with_more_score = paramFlag(taskParams, "investment_with_more_score");
    }
  }

  if (mode === 0) {
    if (theme !== "Phantom") params.stop_at_final_boss = paramFlag(taskParams, "stop_at_final_boss");
    params.stop_at_max_level = paramFlag(taskParams, "stop_at_max_level");
    // Blackflow leveling pushes ending 1; fast flight instead keeps the core's
    // fast burn profile, which is what makes the mechanic jump worth it.
    if (theme === "BlackFlow" && !flight) params.blackflow_strategy = "ending1";
  }

  if (mode === 4) {
    params.collectible_mode_shopping = paramFlag(taskParams, "collectible_mode_shopping");
    params.start_with_elite_two = paramFlag(taskParams, "start_with_elite_two");
    if (params.start_with_elite_two === true) {
      params.only_start_with_elite_two = paramFlag(taskParams, "only_start_with_elite_two");
    }
    const picked = new Set(readStringList(taskParams.collectible_mode_start_list));
    params.collectible_mode_start_list = Object.fromEntries(
      collectibleRewardOptions(theme).map((option) => [String(option.value), picked.has(String(option.value))]),
    );
  }
  const resetSquad = prepFlight ? BLACKFLOW_FLIGHT_SQUAD : paramString(taskParams, "collectible_mode_squad").trim();
  if ((mode === 4 || mode === 30003) && resetSquad !== "") params.collectible_mode_squad = resetSquad;

  if (mode === 6) {
    params.monthly_squad_auto_iterate = paramFlag(taskParams, "monthly_squad_auto_iterate");
    params.monthly_squad_check_comms = paramFlag(taskParams, "monthly_squad_check_comms");
  }
  if (mode === 7) params.deep_exploration_auto_iterate = paramFlag(taskParams, "deep_exploration_auto_iterate");

  if (theme === "Sami") {
    const foldartal = paramString(taskParams, "first_floor_foldartal").trim();
    if (foldartal !== "") params.first_floor_foldartal = foldartal;
    if (mode === 4) {
      const list = readStringList(taskParams.start_foldartal_list).filter((name) => name.trim() !== "");
      if (list.length > 0) params.start_foldartal_list = list;
    }
    if (mode === 5) {
      const paradigms = readStringList(taskParams.expected_collapsal_paradigms).filter((name) => name.trim() !== "");
      if (paradigms.length > 0) params.expected_collapsal_paradigms = paradigms;
    }
  }
  if (theme === "Mizuki") params.refresh_trader_with_dice = paramFlag(taskParams, "refresh_trader_with_dice");

  if (theme === "JieGarden" || theme === "Sarkaz") {
    const seed = paramString(taskParams, "start_with_seed").trim();
    if (seed !== "") params.start_with_seed = seed;
  }
  if (theme === "JieGarden" && mode === 20001) {
    const target = paramNumber(taskParams, "find_playTime_target");
    params.find_playTime_target = target >= 1 && target <= 3 ? Math.trunc(target) : 1;
  }

  if (theme === "BlackFlow" && mode === 30003) {
    const animals = blackflowAnimals(taskParams.blackflow_animal_1, taskParams.blackflow_animal_2);
    const serpent = animals.includes(BLACKFLOW_SERPENT);
    // Both keys are mandatory for mode 30003 even when nothing is required.
    params.blackflow_start_animals = [...animals];
    params.blackflow_start_rewards = blackflowRewardMask(taskParams.blackflow_start_rewards, serpent);
    if (prepFlight) {
      params.collectible_mode_roles = BLACKFLOW_FLIGHT_ROLES;
      params.collectible_mode_core_char_list = [{ name: BLACKFLOW_FLIGHT_CORE_CHAR, use_support: false }];
    }
    if (paramFlag(taskParams, "blackflow_start_utopia")) {
      params.blackflow_start_utopia = true;
      params.blackflow_start_reward_priority = [...blackflowRewardPriority(taskParams.blackflow_start_reward_priority)];
    }
  }

  return params;
}

/**
 * Apply one form edit plus the follow-up rules that keep a Roguelike plan
 * consistent: the theme owns the valid modes and difficulty range, leaving
 * mode 4 clears the opening-reset switches the core would reject, and a written
 * operator list replaces the legacy single-operator keys.
 */
export function withTaskParam(
  type: TaskType,
  params: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...params, [key]: value };
  if (type !== "Roguelike") return next;

  const theme = normalizeRoguelikeTheme(paramString(next, "theme"));
  if (key === "theme") {
    next.mode = roguelikeModeFor(theme, paramNumber(next, "mode"));
    next.difficulty = roguelikeDifficultyValue(theme, paramNumber(next, "difficulty"));
  }
  if (key === "mode") next.mode = roguelikeModeFor(theme, paramNumber(next, "mode"));
  if (key === "mode" && next.mode !== 4) {
    next.start_with_elite_two = false;
    next.only_start_with_elite_two = false;
  }
  if (key === "start_with_elite_two" && value !== true) next.only_start_with_elite_two = false;
  if (key === "core_char_list") {
    // The list is the only operator field the form shows; a leftover single
    // operator would keep being sent for a value the user can no longer see.
    delete next.core_char;
    delete next.use_support;
  }
  if (key === "blackflow_animal_1" && value === BLACKFLOW_SERPENT && next.blackflow_animal_2 === BLACKFLOW_SERPENT) {
    next.blackflow_animal_2 = "";
  }
  if (key === "blackflow_animal_2" && value === BLACKFLOW_SERPENT && next.blackflow_animal_1 === BLACKFLOW_SERPENT) {
    next.blackflow_animal_1 = "";
  }
  if (
    key === "blackflow_start_utopia" &&
    value === true &&
    readStringList(next.blackflow_start_reward_priority).length === 0
  ) {
    next.blackflow_start_reward_priority = [...BLACKFLOW_REWARD_PRIORITY];
  }
  return next;
}

export function buildMaaTaskParams(task: TaskConfig, settings: AppSettings): Record<string, unknown> {
  const common: Record<string, unknown> = {
    enable: true,
    client_type: settings.clientType,
  };

  switch (task.type) {
    case "StartUp":
      return { ...common, ...task.params };
    case "Fight": {
      const params = { ...task.params };
      if (Number(params.times) === 0) delete params.times;
      if (Number(params.medicine) === 0) delete params.medicine;
      if (Number(params.stone) === 0) delete params.stone;
      if (Number(params.medicine_expire_days) === 0) delete params.medicine_expire_days;
      if (params.stage === "") delete params.stage;
      return { ...common, server: "CN", ...params };
    }
    case "Recruit":
      return { ...common, server: "CN", ...task.params };
    case "Infrast": {
      if (Number(task.params.mode) !== 0) {
        return {
          ...common,
          ...task.params,
        };
      }
      return {
        ...common,
        ...task.params,
        fiammetta_targets: ["清流", "可露希尔", "但书"],
      };
    }
    case "Mall":
      return { ...common, ...task.params };
    case "Award":
      return { ...common, ...task.params };
    case "Roguelike":
      return buildRoguelikeParams(task.params, settings);
    case "Reclamation": {
      const params: Record<string, unknown> = { ...common, ...task.params };
      const tools = Array.isArray(params.tools_to_craft)
        ? params.tools_to_craft.filter((value): value is string => typeof value === "string" && value.trim() !== "")
        : [];
      if (tools.length === 0) delete params.tools_to_craft;
      else params.tools_to_craft = tools;
      return params;
    }
    case "Copilot": {
      const params: Record<string, unknown> = {
        ...common,
        formation: task.params.formation !== false,
        add_trust: task.params.add_trust === true,
        ignore_requirements: task.params.ignore_requirements === true,
        use_sanity_potion: task.params.use_sanity_potion === true,
        support_unit_usage: Number(task.params.support_unit_usage) || 0,
        loop_times: Number(task.params.loop_times) >= 1 ? Number(task.params.loop_times) : 1,
      };
      if (Number(task.params.formation_index) > 0) params.formation_index = Number(task.params.formation_index);

      const manual = task.params.manual_start === true;
      // Each checked difficulty is its own MaaCore entry; a row with neither
      // difficulty checked is skipped. The core reports progress by this index,
      // so it must be the position in the expanded list.
      const entries = copilotItemEntries(readCopilotBatch(task.params.copilot_list));
      if (entries.length > 0 && !manual) {
        return {
          ...params,
          copilot_list: entries.map((entry, index) => ({
            id: index,
            filename: entry.item.filename,
            is_raid: entry.mode === "raid",
          })),
        };
      }
      // Legacy single file or manual start: send the stored parameters and drop
      // the batch. Manual start deliberately carries one filename instead of
      // `copilot_list`, so MaaCore starts from the current formation screen and
      // leaves the in-game difficulty (including 沙盘推演) untouched.
      const single: Record<string, unknown> = { ...common, ...task.params };
      delete single.copilot_list;
      delete single.manual_start;
      delete single.is_raid;
      const manualEntry = entries[0];
      if (manual && manualEntry !== undefined) single.filename = manualEntry.item.filename;
      if (Number(task.params.formation_index) <= 0) delete single.formation_index;
      single.loop_times = params.loop_times;
      return single;
    }
    case "SSSCopilot":
      return {
        ...common,
        ...task.params,
        loop_times: Number(task.params.loop_times) >= 1 ? Number(task.params.loop_times) : 1,
      };
    case "ParadoxCopilot":
      return { ...common, ...task.params };
    case "Depot":
    case "OperBox":
      return { ...common, ...task.params };
    case "Custom": {
      const names = Array.isArray(task.params.task_names)
        ? (task.params.task_names as unknown[]).filter((name): name is string => typeof name === "string")
        : [];
      return { ...common, task_names: names };
    }
    case "SingleStep": {
      const requested = paramString(task.params, "subtask");
      const subtask = requested === "start" || requested === "action" ? requested : "stage";
      const params: Record<string, unknown> = { ...common, type: "copilot", subtask };
      if (subtask === "action") {
        const detail: Record<string, unknown> = {
          name: paramString(task.params, "name").trim(),
          location: parseLocation(paramString(task.params, "location")),
          direction: paramString(task.params, "direction") || "右",
        };
        const skill = Number(task.params.skill);
        if (Number.isInteger(skill) && skill >= 1 && skill <= 3) detail.skill = skill;
        params.details = detail;
      } else if (subtask === "stage") {
        params.details = { stage: paramString(task.params, "stage").trim() };
      }
      return params;
    }
    case "VideoRecognition":
      return { ...common, ...task.params };
    case "CloseDown":
      return { ...common, ...task.params };
  }
}

/**
 * Build the normal-stage batch task the copilot tab runs.
 *
 * `manual` switches it to MaaCore's single-file path: one filename, started
 * from the current formation screen instead of navigating from the stage map.
 */
export function createCopilotTask(setup: CopilotSetup, id = crypto.randomUUID(), manual = false): TaskConfig {
  return {
    id,
    type: "Copilot",
    enabled: true,
    name: "",
    params: {
      copilot_list: setup.items.filter(copilotItemActive),
      filename: "",
      formation: setup.options.formation,
      add_trust: setup.options.addTrust,
      ignore_requirements: setup.options.ignoreRequirements,
      use_sanity_potion: setup.options.useSanityPotion,
      support_unit_usage: setup.options.supportUnitUsage,
      loop_times: setup.options.loopTimes,
      formation_index: setup.options.formationIndex,
      manual_start: manual,
    },
    createdAt: 0,
  };
}

/**
 * Turn one saved copilot batch into the MaaCore tasks it needs.
 *
 * Normal assignments share one `Copilot` task with `copilot_list`. SSS has no
 * batch form in MaaCore, so each file becomes its own `SSSCopilot` task; the
 * paradox batch form accepts a list, but MaaCore's task definition in this app
 * only passes one filename, so those also become sequential tasks. Mixing the
 * three families is refused: they start from different screens.
 */
export function createCopilotRunTasks(
  setup: CopilotSetup,
  id = crypto.randomUUID(),
  manual = false,
): ReadonlyArray<TaskConfig> {
  const items = setup.items.filter(copilotItemActive);
  if (items.length === 0) return [];
  const kinds = new Set(items.map((item) => item.kind ?? "normal"));
  if (kinds.size > 1) return [];
  const kind = items[0]!.kind ?? "normal";
  const enabledSetup: CopilotSetup = { ...setup, items };

  if (kind === "sss") {
    return items.map((item, index) => {
      const task = createTask("SSSCopilot", index === 0 ? id : crypto.randomUUID());
      return {
        ...task,
        params: {
          ...task.params,
          filename: item.filename,
          formation: false,
          loop_times: setup.options.loopTimes,
        },
      };
    });
  }

  if (kind === "paradox") {
    return items.map((item, index) => {
      const task = createTask("ParadoxCopilot", index === 0 ? id : crypto.randomUUID());
      return { ...task, params: { ...task.params, filename: item.filename } };
    });
  }

  return [createCopilotTask(enabledSetup, id, manual)];
}

/**
 * A task that has a required field left empty cannot run. Starting a queue with
 * such a task is refused up front instead of surfacing as an opaque MaaCore
 * rejection half way through the queue.
 */
export function firstMissingField(task: TaskConfig): LocalizedText | undefined {
  for (const field of TASK_DEFINITIONS[task.type].fields) {
    if (field.required !== true) continue;
    // A hidden field cannot be filled: SingleStep only asks for the stage in
    // "set stage" mode and only for an operator in "single action" mode.
    if (field.visibleWhen && !field.visibleWhen(task.params)) continue;
    if (field.satisfies) {
      if (!field.satisfies(task.params)) return field.label;
      continue;
    }
    const value = task.params[field.key];
    const filled =
      typeof value === "string"
        ? value.trim() !== ""
        : Array.isArray(value)
          ? value.length > 0
          : value !== undefined && value !== null;
    if (!filled) return field.label;
  }
  return undefined;
}

export function createTask(type: TaskType, id = crypto.randomUUID()): TaskConfig {
  return {
    id,
    type,
    enabled: true,
    name: "",
    params: getTaskDefaults(type),
    createdAt: Date.now(),
  };
}

export function createDefaultPlanTasks(): ReadonlyArray<TaskConfig> {
  return TASK_TYPE_ORDER.map((type) => ({
    ...createTask(type),
    enabled: type !== "CloseDown",
  }));
}
