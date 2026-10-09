/**
 * 元素增删改与对话框显隐的执行。
 *
 * 这一族把「画面怎么变」写成状态（元素表、对话框显隐键），渲染层按状态落地；
 * 核心不碰 DOM。元素表 `SYS.elements` 是纯数据，随快照、存档、回溯自动随行。
 */
import {
  ELEMENT_ATTRIBUTES,
  SYS,
  type ElementInstance,
  type StoryCommand,
} from "../../../contracts";
import { removeElements } from "../../../data";
import type { OpContext } from "../../internal";

/**
 * 元素增删 op 已知负载字段（未知字段 fail-closed）。
 * `show.target` = 资源路径（落 `props.source`）。
 */
const ELEMENT_OP_FIELDS: Record<string, ReadonlySet<string>> = {
  show: new Set(["op", "target", "x", "y", "id", "name", "background"]),
  hide: new Set(["op", "target"]),
  background: new Set(["op", "resource"]),
  bg_switch: new Set(["op", "resource"]),
  zindex: new Set(["op", "target", "value"]),
  style: new Set(["op", "target", "props"]),
  window: new Set(["op", "mode"]),
  animate: new Set(["op", "target", "property", "value", "duration", "easing"]),
  animate_block: new Set([
    "op",
    "target",
    "x",
    "y",
    "opacity",
    "rotation",
    "scale",
    "duration",
    "easing",
  ]),
  transition: new Set(["op", "type", "duration"]),
  shake: new Set(["op", "intensity", "duration"]),
  text_typewriter: new Set(["op", "enabled", "speed"]),
};

/** 背景元素固定底层序（`Order = -1000`） */
const BACKGROUND_Z = -1000;

/**
 * 元素增删（`show` / `hide` / `background` / `bg_switch`）：统一进**同一元素表**
 * `SYS.elements`（纯数据，随快照/存档/回溯自动随行）。
 *
 * - `show`：追加元素；`background=true` 先清旧背景并固定底层序（`BACKGROUND_Z`）
 * - `hide`：按 `id`/`name`/`source` 移除，递归含 children；未命中**幂等不报错**
 * - `background` / `bg_switch`：换背景（先清旧背景 → 追加，固定底层序）
 */
export function execElementVisual(
  ctx: OpContext,
  cmd: StoryCommand,
): boolean {
  const known = ELEMENT_OP_FIELDS[cmd.op]!;
  const unknown = Object.keys(cmd).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    ctx.fail(
      `${cmd.op}-unknown-field`,
      `${cmd.op} 未知负载字段：${unknown.join(", ")}`,
    );
    return false;
  }
  const current = ctx.elements();

  if (cmd.op === "hide") {
    const target = typeof cmd.target === "string" ? cmd.target : "";
    if (target === "") {
      ctx.fail(
        "hide-invalid",
        "hide.target 必须为非空目标（id / name / source 任一）",
      );
      return false;
    }
    ctx.setSystem(SYS.elements, removeElements(current, target).next);
    return true;
  }

  if (cmd.op === "show") {
    const target = typeof cmd.target === "string" ? cmd.target : "";
    if (target === "") {
      ctx.fail("show-invalid", "show.target 必须为非空资源路径（写入 source）");
      return false;
    }
    for (const key of ["x", "y"] as const) {
      const value = cmd[key];
      if (
        value !== undefined &&
        typeof value !== "number" &&
        typeof value !== "string"
      ) {
        ctx.fail(
          "show-invalid",
          `show.${key} 必须为数字或字符串（CSS 长度）`,
        );
        return false;
      }
    }
    return appendElement(ctx, current, target, {
      isBackground: cmd.background === true,
      id: typeof cmd.id === "string" && cmd.id !== "" ? cmd.id : undefined,
      name:
        typeof cmd.name === "string" && cmd.name !== "" ? cmd.name : undefined,
      x: cmd.x,
      y: cmd.y,
    });
  }

  if (cmd.op === "zindex") {
    const target = typeof cmd.target === "string" ? cmd.target : "";
    const value = cmd.value;
    if (target === "" || typeof value !== "number" || !Number.isFinite(value)) {
      ctx.fail(
        "zindex-invalid",
        "zindex 需要 target（非空）与 value（有限数字）",
      );
      return false;
    }
    const hits = ctx.findElements(target);
    if (hits.length === 0) {
      ctx.fail("zindex-target-not-found", `zindex 未命中任何元素：${target}`);
      return false;
    }
    ctx.setSystem(
      SYS.elements,
      ctx.mapElements((el) => (hits.includes(el) ? { ...el, z: value } : el)),
    );
    return true;
  }

  if (cmd.op === "style") {
    const target = typeof cmd.target === "string" ? cmd.target : "";
    const raw = cmd.props;
    if (
      target === "" ||
      raw === null ||
      typeof raw !== "object" ||
      Array.isArray(raw)
    ) {
      ctx.fail("style-invalid", "style 需要 target（非空）与 props（对象）");
      return false;
    }
    const styleProps = raw as Record<string, unknown>;
    // 样式键必须在元素属性全集内（未知属性 fail-closed）
    const unknown = Object.keys(styleProps).filter(
      (k) => !ELEMENT_ATTRIBUTES.has(k),
    );
    if (unknown.length > 0) {
      ctx.fail(
        "style-unknown-attr",
        `style 未知元素属性：${unknown.join(", ")}`,
      );
      return false;
    }
    const hits = ctx.findElements(target);
    if (hits.length === 0) {
      ctx.fail("style-target-not-found", `style 未命中任何元素：${target}`);
      return false;
    }
    ctx.setSystem(
      SYS.elements,
      ctx.mapElements((el) =>
        hits.includes(el) ? { ...el, props: { ...el.props, ...styleProps } } : el,
      ),
    );
    return true;
  }

  // background / bg_switch：换背景
  const resource = typeof cmd.resource === "string" ? cmd.resource : "";
  if (resource === "") {
    ctx.fail(`${cmd.op}-invalid`, `${cmd.op}.resource 必须为非空资源路径`);
    return false;
  }
  return appendElement(ctx, current, resource, { isBackground: true });
}

/**
 * 对话框显隐三态：`auto`（跟随对话态，默认）| `show`（强制显示）| `hide`（强制隐藏）。
 * 只写状态；DOM 可见性归 UI 层（核心只写状态）。
 */
export function execWindow(ctx: OpContext, cmd: StoryCommand): boolean {
  const mode = cmd.mode;
  if (mode !== "auto" && mode !== "show" && mode !== "hide") {
    ctx.fail("window-invalid", 'window.mode 必须为 "auto" | "show" | "hide"');
    return false;
  }
  ctx.setSystem(SYS.dialogVisible, mode);
  return true;
}

/**
 * 追加元素到空间层（背景先清旧背景 + 固定底层序）。
 * `id` 缺省按**追加序**派生（确定性：同序重放得到同 id），显式 `id` 优先。
 */
function appendElement(
  ctx: OpContext,
  current: readonly ElementInstance[],
  source: string,
  options: {
    isBackground: boolean;
    id?: string;
    name?: string;
    x?: unknown;
    y?: unknown;
  },
): boolean {
  const base = options.isBackground
    ? current.filter((e) => e.type !== "background")
    : [...current];
  const props: Record<string, unknown> = { source };
  if (options.isBackground) {
    props.x = 0;
    props.y = 0;
  } else {
    if (options.x !== undefined) props.x = options.x;
    if (options.y !== undefined) props.y = options.y;
  }
  const element: ElementInstance = {
    id:
      options.id ?? (options.isBackground ? "background" : `show#${base.length}`),
    type: options.isBackground ? "background" : "image",
    props,
    z: options.isBackground ? BACKGROUND_Z : base.length,
    children: [],
  };
  if (options.name !== undefined) element.name = options.name;
  base.push(element);
  ctx.setSystem(SYS.elements, base);
  return true;
}
