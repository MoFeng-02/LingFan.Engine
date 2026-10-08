/**
 * 点击动作解析（输入语义归核心层，UI 只做翻译）。
 *
 * **`disabled` > `nav` > `ops` > `cmd`** —— 前四级决定**点击行为**：
 * - `disabled` 短路（可写布尔，也可写表达式原文如 `{player.gold < 10}`，点击时刻求值）
 * - `nav` 优先于 `ops`/`cmd`（跳列是最直接的编排语义）
 * - `ops` = **数据侧动作序列**（点一下按序执行一串 op，复用引擎既有 op 分发表）
 * - `cmd` = 宿主命名命令（宿主自有业务：打开面板、外部跳转…）
 *
 * `hover_*` / `selected_*` / `disabled_*` 是与点击**正交**的视觉态（由渲染器绑定）。
 *
 * 纯函数：宿主据此选路（`nav` → 核心 `navigate`；`ops` → 引擎 `runElementOps`；
 * `cmd` → 宿主命名命令注册表）。
 */
import type { ElementInstance } from "@lingfan/engine";

export type ElementAction =
  | { kind: "none" }
  /** 禁用：不产生任何动作（调用方应短路，不挂点击） */
  | { kind: "disabled" }
  | { kind: "nav"; target: string }
  /** 数据侧动作序列：原样交给引擎（表达式在点击时刻由引擎求值） */
  | { kind: "ops"; ops: readonly Record<string, unknown>[] }
  /** `value` 为原文（可能含 `{expr}`）——宿主按点击时刻插值后再交处理器 */
  | { kind: "cmd"; name: string; value?: string };

export interface ElementActionOptions {
  /**
   * `disabled` 表达式求值（返回 null = 求值失败）。
   * 由宿主注入（引擎侧 `interpolate`+解析）；缺省 = 不求解，字符串形态按「未禁用」处理。
   */
  evalDisable?: (expression: string) => boolean | null;
}

/**
 * 禁用判定（`enabled === false` 与 `disabled` 同义，任一命中即禁用）。
 *
 * 表达式求值失败（null）= **不禁用**：宁可点得动、由 `ops` 执行期 fail-closed 报错，
 * 也不因求值问题让玩家彻底无法交互（禁用态误判是「锁死」，比报错更难恢复）。
 */
export function isElementDisabled(
  props: Record<string, unknown>,
  options: ElementActionOptions = {},
): boolean {
  if (props.enabled === false) return true;
  const value = props.disabled;
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && value !== "") {
    if (options.evalDisable === undefined) return false;
    return options.evalDisable(value) === true;
  }
  return false;
}

/**
 * `ops` 负载形态校验：非空数组，每项为对象且 `op` 为非空字符串。
 * 畸形 = 无声明的形态 ⇒ 返回 null（调用方按「未声明 ops」继续，由引擎解析期 fail-closed 报错）。
 */
function readOps(value: unknown): readonly Record<string, unknown>[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return null;
    }
    const op = (item as { op?: unknown }).op;
    if (typeof op !== "string" || op === "") return null;
  }
  return value as readonly Record<string, unknown>[];
}

export function resolveElementAction(
  props: Record<string, unknown>,
  options: ElementActionOptions = {},
): ElementAction {
  // 最高优先级：禁用 → 不产生任何动作
  if (isElementDisabled(props, options)) return { kind: "disabled" };

  const nav = props.nav;
  if (typeof nav === "string" && nav !== "") return { kind: "nav", target: nav };

  const ops = readOps(props.ops);
  if (ops !== null) return { kind: "ops", ops };

  const cmd = props.cmd;
  if (typeof cmd === "string" && cmd !== "") {
    const value = props.value;
    return typeof value === "string"
      ? { kind: "cmd", name: cmd, value }
      : { kind: "cmd", name: cmd };
  }
  return { kind: "none" };
}

/** 元素是否拥有交互（点击类）——渲染器据此决定是否挂点击与手型光标 */
export function hasElementInteraction(
  props: Record<string, unknown>,
  options: ElementActionOptions = {},
): boolean {
  const action = resolveElementAction(props, options);
  return action.kind !== "none" && action.kind !== "disabled";
}

/** 供宿主把动作翻译成引擎/注册表调用（`source` 回传给命令处理器） */
export type ElementActionSource = ElementInstance;
