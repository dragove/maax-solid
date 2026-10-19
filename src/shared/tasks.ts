import type { AppSettings, TaskConfig, TaskType } from "./schemas";

/**
 * Declarative task catalogue shared by the renderer forms and the main process
 * builder. MaaCore does not publish a machine-readable schema for
 * `AsstAppendTask`, so this file owns the supported subset and its defaults.
 */
export interface LocalizedText {
  readonly zh: string;
  readonly en: string;
}

export type FieldKind = "switch" | "number" | "text" | "stage" | "select" | "multi-select" | "tags";

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

export const TASK_TYPE_ORDER: ReadonlyArray<TaskType> = [
  "StartUp",
  "Fight",
  "Recruit",
  "Infrast",
  "Mall",
  "Award",
  "CloseDown",
];

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
    case "CloseDown":
      return {};
  }
}

export function taskDisplayName(type: TaskType, customName = ""): LocalizedText {
  return customName.trim() === "" ? TASK_DEFINITIONS[type].name : { zh: customName, en: customName };
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
    case "CloseDown":
      return { ...common, ...task.params };
  }
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
