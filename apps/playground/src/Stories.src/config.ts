/**
 * Stories.src 唯一声明点（config 化，default 对象形态）：
 * `export default { ... } satisfies StoriesConfig` 强类型单出口——folders/start 必需，
 * version/vars/state 可缺省；named exports 形态仍兼容，但同文件两种形态混用会报错。
 * - folders/start：构建布局（列清单与开场列）；
 * - vars：插值键声明（defineVars 清单，进 InterpolationKeyRegistry）；
 * - state：形态 A（键集对象）——与 define 累积（形态 B）二选一。
 *
 * 本文件是构建期被求值的唯一根文件（根级唯一，相对导入仅限作者常量，如 Sex 枚举）。
 */
import { Sex } from "./lib/enums";

export default {
  folders: [
    "chapter1",
    "chapter2",
    "chapter3",
    "chapter4",
    "chapter5",
    "chapter6",
  ],
  start: "start.ts",
  // 新增了状态键（world.*），版本必须跟着升：旧档的 storyVersion 对不上会整档拒绝，
  // 而不是带着缺键的存档进新流程。
  version: 2,

  // vars 只登记 state 树未覆盖的插值键：define 的键自动进 InterpolationKeyRegistry
  // （四源合并去重，类型由初始值/描述符推断），无需重复登记。
  vars: defineVars({
    n: "num",
    m: "num",
  }),

  // 形态 A：键集对象声明状态初始树（与旧 stateSchema 全键等值）。
  // 简写标量 = 常量默认值；{ type, default } descriptor = 类型 + 默认值；
  // 数组类型用 ["string"]；枚举 type 传 Sex（成员值联合）。
  state: {
    player: {
      gold: 100,
      level: { type: "number", default: 1 },
      sex: { type: Sex, default: Sex.Male },
      name: { type: "string", default: "旅人" },
    },
    dice: { type: "number", default: 1 },
    supplies: { type: ["string"], default: [] },
    // 功能演示章的一次性相位标记：feat_play 首访走交互、再访走小游戏。
    journal: { flag: { type: "number", default: 0 } },
    // 沙盒地图的三格：去过哪些房间、灯亮着没有、地图上正看着哪一间。
    // 组件实际读写的是 `game.world.*`（玩法系统写口只能落在那一段）；这里的同名声明
    // 只给类型面与初始值，两套键互不覆盖，读不到时组件自己兜底。
    world: {
      visited: { type: ["string"], default: [] },
      lamp: { type: "number", default: 0 },
      focus: { type: "string", default: "" },
    },
  },
} satisfies StoriesConfig;
