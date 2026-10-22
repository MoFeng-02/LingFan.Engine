/**
 * 守卫名收集与登记校验：把「故事提到了哪些守卫实现」变成装载后即可断言的事实。
 *
 * 守卫是**组合根注册制**——名字写在内容里、实现由宿主注入（`StoryEngine` 选项
 * `guards`），两者可能分开发布：小程序的故事与资源走 HTTP，改故事不必发小程序版本。
 * 因此「故事里有、宿主没登记」不该等到执行到那条命令才 fail-closed，装载完成即校验，
 * 缺谁一次报全，错误发生在起播之前。
 *
 * 只认名字、不看语义：`args` 是纯数据（里面出现的对象不是命令），守卫实现与参数
 * 合法性都不在这里检查——那是执行期的事。
 */
import type { GuardFn, Story } from "../contracts/index.ts";

/** 一次命令走查的上下文：去重集合 + 首次出现顺序 */
interface GuardNameScan {
  seen: Set<string>;
  names: string[];
}

/**
 * 递归走查命令块，收出 `guard` 命令引用的守卫名。
 *
 * 命令块没有统一的类型（各 op 的嵌套字段名由 op 自己定，如 `then` / `else` /
 * `body` / 分支数组），所以这里按「任意嵌套结构」走：只要对象带 `op: "guard"` 且
 * `fn` 是非空字符串即收。`args` 是纯数据，**不往下走**，免得把参数里的同形对象当命令。
 */
function scanCommands(value: unknown, scan: GuardNameScan): void {
  if (Array.isArray(value)) {
    for (const item of value) scanCommands(item, scan);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  if (record["op"] === "guard") {
    const name = record["fn"];
    if (typeof name === "string" && name !== "" && !scan.seen.has(name)) {
      scan.seen.add(name);
      scan.names.push(name);
    }
  }
  for (const [key, nested] of Object.entries(record)) {
    if (key === "args") continue;
    scanCommands(nested, scan);
  }
}

/**
 * 收集故事引用的守卫名（去重，按首次出现顺序）。
 *
 * 两种列都走：scene 列的 `entry` 与 flow 列的 `commands`——守卫不挑列的形态。
 */
export function collectGuardNames(story: Story): string[] {
  const scan: GuardNameScan = { seen: new Set(), names: [] };
  for (const column of story.columns) {
    scanCommands(column.entry, scan);
    scanCommands(column.commands, scan);
  }
  return scan.names;
}

/**
 * 缺登记的守卫名（故事提到、注册表里没有）；空数组 = 齐全。
 *
 * 判定走 `hasOwnProperty`：`toString` 之类的原型链名字不算登记。
 */
export function findMissingGuards(
  story: Story,
  guards: Readonly<Record<string, GuardFn>>,
): string[] {
  return collectGuardNames(story).filter(
    (name) => !Object.prototype.hasOwnProperty.call(guards, name),
  );
}
