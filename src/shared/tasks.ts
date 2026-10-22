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

export type FieldKind = "switch" | "number" | "text" | "stage" | "select" | "multi-select" | "tags" | "file";

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
  readonly options?: ReadonlyArray<FieldOption>;
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

/** Rewards offered by the mode-4 opening reset; the core wants a flag object. */
const COLLECTIBLE_REWARDS: ReadonlyArray<FieldOption> = [
  { value: "hot_water", label: { zh: "热水壶", en: "Hot water" } },
  { value: "shield", label: { zh: "护盾", en: "Shield" } },
  { value: "ingot", label: { zh: "源石锭", en: "Ingot" } },
  { value: "hope", label: { zh: "希望", en: "Hope" } },
  { value: "random", label: { zh: "随机奖励", en: "Random reward" } },
  { value: "key", label: { zh: "钥匙", en: "Key" } },
  { value: "dice", label: { zh: "骰子", en: "Dice" } },
  { value: "ideas", label: { zh: "构想 ×2", en: "2 Ideas" } },
  { value: "ticket", label: { zh: "票券", en: "Ticket" } },
];

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
      zh: "自动刷取肉鸽分数、源石锭或主题奖励，可指定主题、分队与开局干员。",
      en: "Farm Integrated Strategies score, ingots or theme rewards with a chosen squad and starting operator.",
    },
    icon: "compass",
    fields: [
      {
        key: "theme",
        kind: "select",
        label: { zh: "主题", en: "Theme" },
        options: [
          { value: "Phantom", label: { zh: "傀影与猩红血钻", en: "Phantom & Crimson Solitaire" } },
          { value: "Mizuki", label: { zh: "水月与深蓝之树", en: "Mizuki & Caerula Arbor" } },
          { value: "Sami", label: { zh: "探索者的银凇止境", en: "Expeditioner's Jǫklumarkar" } },
          { value: "Sarkaz", label: { zh: "萨卡兹的无终奇语", en: "Tales of the Unfathomable" } },
          { value: "JieGarden", label: { zh: "岁的界园志异", en: "Sui's Garden of Grotesqueries" } },
        ],
      },
      {
        key: "mode",
        kind: "select",
        label: { zh: "模式", en: "Mode" },
        options: [
          { value: 0, label: { zh: "刷分与奖励", en: "Score & rewards" } },
          { value: 1, label: { zh: "刷源石锭", en: "Farm ingots" } },
          { value: 4, label: { zh: "凹开局", en: "Opening reset" } },
          { value: 5, label: { zh: "刷坍缩范式（萨米）", en: "Collapsal paradigms (Sami)" } },
          { value: 6, label: { zh: "月度小队", en: "Monthly squad" } },
          { value: 7, label: { zh: "深入调查", en: "Deep exploration" } },
        ],
      },
      {
        key: "squad",
        kind: "text",
        label: { zh: "分队", en: "Squad" },
        placeholder: { zh: "指挥分队", en: "指挥分队" },
        description: { zh: "填写游戏内中文分队名。", en: "Use the in-game Chinese squad name." },
      },
      {
        key: "roles",
        kind: "text",
        label: { zh: "职业组", en: "Role group" },
        placeholder: { zh: "取长补短", en: "取长补短" },
        description: { zh: "填写游戏内中文职业组名。", en: "Use the in-game Chinese role group name." },
      },
      {
        key: "core_char",
        kind: "text",
        label: { zh: "开局干员", en: "Starting operator" },
        placeholder: { zh: "留空则按练度自动选择", en: "Leave empty to pick automatically" },
        description: { zh: "仅支持单个干员的中文名。", en: "A single operator's Chinese name." },
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
      {
        key: "difficulty",
        kind: "number",
        label: { zh: "难度等级", en: "Difficulty" },
        min: 0,
        max: 99,
        step: 1,
        description: { zh: "0 表示使用当前已解锁的最高难度。", en: "0 uses the highest unlocked difficulty." },
      },
      {
        key: "investment_enabled",
        kind: "switch",
        label: { zh: "投资源石锭", en: "Invest ingots" },
      },
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
        key: "stop_at_final_boss",
        kind: "switch",
        label: { zh: "最终 Boss 前停止", en: "Stop before the final boss" },
        description: { zh: "仅适用于非傀影主题。", en: "Not available in Phantom & Crimson Solitaire." },
        advanced: true,
        visibleWhen: (params) => paramString(params, "theme") !== "Phantom",
      },
      {
        key: "stop_at_max_level",
        kind: "switch",
        label: { zh: "等级刷满后停止", en: "Stop at max level" },
        advanced: true,
      },
      {
        key: "stop_when_investment_full",
        kind: "switch",
        label: { zh: "投资满后停止", en: "Stop when investment is full" },
        advanced: true,
      },
      {
        key: "investment_with_more_score",
        kind: "switch",
        label: { zh: "投资后继续购物", en: "Shop after investing" },
        description: { zh: "仅适用于刷源石锭模式。", en: "Only used by the Originium Ingot farming mode." },
        advanced: true,
        visibleWhen: (params) => paramNumber(params, "mode") === 1,
      },
      {
        key: "use_support",
        kind: "switch",
        label: { zh: "开局干员为助战", en: "Starting operator is support" },
        advanced: true,
      },
      {
        key: "use_nonfriend_support",
        kind: "switch",
        label: { zh: "允许非好友助战", en: "Allow non-friend support" },
        advanced: true,
        visibleWhen: (params) => paramFlag(params, "use_support"),
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
        options: COLLECTIBLE_REWARDS,
        advanced: true,
        visibleWhen: (params) => paramNumber(params, "mode") === 4,
      },
      {
        key: "collectible_mode_squad",
        kind: "text",
        label: { zh: "凹开局分队", en: "Reset squad" },
        placeholder: { zh: "留空则与分队相同", en: "Empty uses the squad above" },
        advanced: true,
        visibleWhen: (params) => paramNumber(params, "mode") === 4,
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
        description: { zh: "仅适用于萨米主题。", en: "Only used by the Sami theme." },
        advanced: true,
        visibleWhen: (params) => paramString(params, "theme") === "Sami",
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
        description: { zh: "仅适用于水月主题。", en: "Only used by the Mizuki theme." },
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

/** A copilot task can carry a batch of assignments instead of one file. */
export const hasCopilotList = (params: Record<string, unknown>): boolean =>
  Array.isArray(params.copilot_list) && params.copilot_list.length > 0;

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
        squad: "指挥分队",
        roles: "取长补短",
        core_char: "",
        starts_count: 0,
        difficulty: 0,
        investment_enabled: true,
        investments_count: 0,
        stop_at_final_boss: false,
        stop_at_max_level: false,
        stop_when_investment_full: false,
        investment_with_more_score: false,
        use_support: false,
        use_nonfriend_support: false,
        start_with_elite_two: false,
        only_start_with_elite_two: false,
        collectible_mode_start_list: [],
        collectible_mode_squad: "",
        collectible_mode_shopping: false,
        first_floor_foldartal: "",
        expected_collapsal_paradigms: ["目空一些", "睁眼瞎", "图像损坏", "一抹黑"],
        refresh_trader_with_dice: false,
        monthly_squad_auto_iterate: false,
        monthly_squad_check_comms: false,
        deep_exploration_auto_iterate: false,
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
    case "Roguelike": {
      const params: Record<string, unknown> = { ...common, ...task.params };
      // The core treats an omitted count as "unlimited" and an omitted operator
      // as "pick by level", so zero and empty strings stay out of the payload.
      for (const key of ["core_char", "first_floor_foldartal", "collectible_mode_squad"]) {
        if (paramString(params, key).trim() === "") delete params[key];
      }
      if (Number(params.starts_count) === 0) delete params.starts_count;
      if (Number(params.investments_count) === 0) delete params.investments_count;

      const paradigms = Array.isArray(params.expected_collapsal_paradigms)
        ? params.expected_collapsal_paradigms.filter(
            (value): value is string => typeof value === "string" && value.trim() !== "",
          )
        : [];
      if (paradigms.length === 0) delete params.expected_collapsal_paradigms;
      else params.expected_collapsal_paradigms = paradigms;

      const rewards = Array.isArray(params.collectible_mode_start_list)
        ? params.collectible_mode_start_list.filter((value): value is string => typeof value === "string")
        : [];
      if (rewards.length === 0) delete params.collectible_mode_start_list;
      else {
        params.collectible_mode_start_list = Object.fromEntries(
          COLLECTIBLE_REWARDS.map((option) => [String(option.value), rewards.includes(String(option.value))]),
        );
      }
      return params;
    }
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

      const batch = Array.isArray(task.params.copilot_list) ? task.params.copilot_list : [];
      const entries = batch.flatMap((item) => {
        const entry = item as { filename?: unknown; isRaid?: unknown };
        if (typeof entry.filename !== "string" || entry.filename.trim() === "") return [];
        // The core reports progress by this index, so it must be the position in
        // the whole list; normal and raid runs of one file share the file.
        return [{ id: 0, filename: entry.filename, is_raid: entry.isRaid === true }];
      });
      if (entries.length > 0) {
        return { ...params, copilot_list: entries.map((entry, index) => ({ ...entry, id: index })) };
      }
      // Legacy single file: send the stored parameters and drop the empty batch.
      const single: Record<string, unknown> = { ...common, ...task.params };
      delete single.copilot_list;
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

/** Build the normal-stage batch task the copilot tab runs. */
export function createCopilotTask(setup: CopilotSetup, id = crypto.randomUUID()): TaskConfig {
  return {
    id,
    type: "Copilot",
    enabled: true,
    name: "",
    params: {
      copilot_list: [...setup.items],
      filename: "",
      formation: setup.options.formation,
      add_trust: setup.options.addTrust,
      ignore_requirements: setup.options.ignoreRequirements,
      use_sanity_potion: setup.options.useSanityPotion,
      support_unit_usage: setup.options.supportUnitUsage,
      loop_times: setup.options.loopTimes,
      formation_index: setup.options.formationIndex,
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
export function createCopilotRunTasks(setup: CopilotSetup, id = crypto.randomUUID()): ReadonlyArray<TaskConfig> {
  if (setup.items.length === 0) return [];
  const kinds = new Set(setup.items.map((item) => item.kind ?? "normal"));
  if (kinds.size > 1) return [];
  const kind = setup.items[0]!.kind ?? "normal";

  if (kind === "sss") {
    return setup.items.map((item, index) => {
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
    return setup.items.map((item, index) => {
      const task = createTask("ParadoxCopilot", index === 0 ? id : crypto.randomUUID());
      return { ...task, params: { ...task.params, filename: item.filename } };
    });
  }

  return [createCopilotTask(setup, id)];
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
