/**
 * Stories.src 唯一声明点（config 化，界面规范 对应章节）：
 * named exports 四导出——folders/start 必需，vars/state 可缺省。
 * - folders/start：构建布局（列清单与开场列）；
 * - vars：插值键声明（defineVars 清单，进 InterpolationKeyRegistry）；
 * - state：形态 B（define 累积）示范——构建期求值后降维为 defines（全平铺存储，对应章节判定）。
 *
 * 本文件是构建期被求值的唯一根文件（根级唯一，相对导入仅限作者常量，如 Sex 枚举）。
 */
import { Sex } from "./lib/enums";

export const folders = ["chapter1", "chapter2", "chapter3", "chapter4"];

export const start = "start.ts";

export const vars = defineVars({
  "player.gold": "num",
  "player.name": "str",
  n: "num",
  m: "num",
  dice: "num",
  "journal.flag": "num",
});

// 形态 B：define 累积（与旧 stateSchema 全键等值）。
// 简写标量 = 常量默认值；{ type, default } descriptor = 类型 + 默认值；
// 数组类型用 ["string"]；枚举 type 传 Sex（成员值联合）。
define("player.gold", 100);
define("player.level", { type: "number", default: 1 });
define("player.sex", { type: Sex, default: Sex.Male });
define("player.name", { type: "string", default: "旅人" });
define("dice", { type: "number", default: 1 });
define("supplies", { type: ["string"], default: [] });
