/**
 * Script 词汇层 · **元素域**（show / hide / background / bg_switch / zindex / style /
 * window / animate / animate_block / transition / shake / text_typewriter）。
 * x/y = 数字（px）或 CSS 长度串（`"50%"`）——与元素系统契约一致。
 * Options 派生自 schema（零漂移）；返回类型 = `CommandOf<op>` 判别联合成员。
 */
import type { CommandOf, ScriptValue } from "../../schema";

/** show 的可选项：x/y 位置（数字 px 或 CSS 长度串）、id/name 标识、background 背景位 */
export type ShowOptions = Omit<CommandOf<"show">, "op" | "target">;

/**
 * 在画面上追加一个元素：`target` 是资源路径（落到元素的 source）。
 * 故事立即继续，不等待。
 *
 * - `x` / `y` 定位（数字 px 或 `"50%"` 长度串）；`id` / `name` 给元素
 *   起标识（之后 {@link hide} / {@link setZ} / {@link style} / {@link animate}
 *   按它寻址）。
 * - `background: true` 表示这是一张背景：先清掉旧背景再追加，固定在最底层。
 *
 * @param target 元素资源路径。
 * @param opts 可选项，见 {@link ShowOptions}。
 * @returns `show` 故事命令。
 * @example
 * show("images/npc_guide.png", { x: "30%", y: "40%", id: "guide" });
 */
export function show(target: string, opts?: ShowOptions): CommandOf<"show"> {
  return { op: "show", target, ...opts };
}

/**
 * 从画面移除元素：按 `id` / `name` / 资源路径匹配（含子元素）。
 * 没找到就什么都不做（幂等，不报错）。立即生效、故事继续。
 * @param target 要移除的元素（id、name 或资源路径）。
 * @returns `hide` 故事命令。
 * @example
 * hide("guide");
 */
export function hide(target: string): CommandOf<"hide"> {
  return { op: "hide", target };
}

/**
 * 换背景：先清掉旧背景，再把新图追加为固定在最底层的背景元素。
 * 立即生效、故事继续。
 * @param resource 背景图资源路径。
 * @returns `background` 故事命令。
 * @example
 * background("images/inn_night.png");
 */
export function background(resource: string): CommandOf<"background"> {
  return { op: "background", resource };
}

/**
 * 切换背景（与 {@link background} 同语义的另一形式）：先清旧背景再追加新背景。
 * @param resource 背景图资源路径。
 * @returns `bg_switch` 故事命令。
 */
export function bgSwitch(resource: string): CommandOf<"bg_switch"> {
  return { op: "bg_switch", resource };
}

/**
 * 调整元素层级（z 序）。目标元素未找到时报错停机。
 * @param target 元素（id、name 或资源路径）。
 * @param value 新层级值（数字越大越靠上）。
 * @returns `zindex` 故事命令。
 */
export function setZ(target: string, value: number): CommandOf<"zindex"> {
  return { op: "zindex", target, value };
}

/**
 * 批量修改元素的展示属性（键限于元素系统支持的属性集，未知键报错停机）。
 * @param target 元素（id、name 或资源路径）。
 * @param props 属性名 → 新值的映射。
 * @returns `style` 故事命令。
 * @example
 * style("guide", { opacity: 0.6 });
 */
export function style(
  target: string,
  props: Record<string, ScriptValue>,
): CommandOf<"style"> {
  return { op: "style", target, props: { ...props } };
}

/** 对话框显隐模式：auto 跟随对话状态（缺省）、show 显示、hide 隐藏 */
export type DialogWindowMode = CommandOf<"window">["mode"];

/**
 * 控制对话框窗口的显隐：`"auto"` 跟随对话状态（默认行为）、
 * `"show"` 强制显示、`"hide"` 强制隐藏。立即生效、故事继续。
 * @param mode 显隐模式。
 * @returns `window` 故事命令。
 * @example
 * dialogWindow("hide");   // 无对话演出时收起对话框
 */
export function dialogWindow(mode: DialogWindowMode): CommandOf<"window"> {
  return { op: "window", mode };
}

/** animate 的可选项：duration 时长（秒，缺省 0.3）、easing 缓动名（缺省 EaseOutQuad） */
export type AnimateOptions = Omit<
  CommandOf<"animate">,
  "op" | "target" | "property" | "value"
>;

/**
 * 让元素的某个属性平滑过渡到目标值：起点取元素当前值（无值按 0），
 * 结束值写回元素。故事**不等待**动画播完，直接继续执行下一句。
 * @param target 元素（id、name 或资源路径）。
 * @param property 要动的属性名（如 x / opacity）。
 * @param value 目标值。
 * @param opts 可选项：duration 秒数（缺省 0.3）、easing 缓动名。
 * @returns `animate` 故事命令。
 * @example
 * animate("guide", "x", "60%", { duration: 0.5 });
 */
export function animate(
  target: string,
  property: string,
  value: number,
  opts?: AnimateOptions,
): CommandOf<"animate"> {
  return { op: "animate", target, property, value, ...opts };
}

export type AnimateBlockOptions = Omit<
  CommandOf<"animate_block">,
  "op" | "target"
>;

/**
 * 让元素的多个属性**同时**平滑过渡（共用一个 duration，并行插值）。
 * 故事不等待；需要先后顺序时改用多条 {@link animate}。
 * @param target 元素（id、name 或资源路径）。
 * @param opts 目标属性（x/y/opacity/rotation/scale，数字）+ duration 秒数
 *   （缺省 0.3）+ easing 缓动名（缺省 EaseOutQuad）。
 * @returns `animate_block` 故事命令。
 * @example
 * animateBlock("guide", { x: 300, opacity: 1, duration: 0.6 });
 */
export function animateBlock(
  target: string,
  opts?: AnimateBlockOptions,
): CommandOf<"animate_block"> {
  return { op: "animate_block", target, ...opts };
}

/**
 * 全屏转场效果（如淡入淡出、黑屏）：`type` 给出转场名（必填），
 * `duration` 控制时长（秒，缺省 0.5）。立即生效、故事继续。
 * @param type 转场类型名。
 * @param duration 转场时长（秒）。
 * @returns `transition` 故事命令。
 * @example
 * transition("fade", 0.8);
 */
export function transition(
  type: string,
  duration?: number,
): CommandOf<"transition"> {
  return {
    op: "transition",
    type,
    ...(duration === undefined ? {} : { duration }),
  };
}

/** shake 的可选项：intensity 震动强度（缺省 8）、duration 时长（秒） */
export type ShakeOptions = Omit<CommandOf<"shake">, "op">;

/**
 * 让画面震动一下（表现强调）。故事立即继续，不等待。
 * @param opts 可选项：intensity 强度（缺省 8）、duration 时长（秒）。
 * @returns `shake` 故事命令。
 * @example
 * shake({ intensity: 12 });
 */
export function shake(opts?: ShakeOptions): CommandOf<"shake"> {
  return { op: "shake", ...opts };
}

/** text_typewriter 的可选项：enabled 开关、speed 打字速度（字符/秒，至少其一） */
export type TypewriterOptions = Omit<CommandOf<"text_typewriter">, "op">;

/**
 * 设置全局打字机效果：`enabled` 开关、`speed` 打字速度（字符/秒）——
 * 两者至少给一个。与玩家自己的偏好设置分离：玩家显式设置时以玩家为准。
 * 立即生效、故事继续。
 * @param opts 可选项：enabled 开关、speed 速度（字符/秒）。
 * @returns `text_typewriter` 故事命令。
 * @example
 * textTypewriter({ enabled: true, speed: 30 });
 */
export function textTypewriter(
  opts?: TypewriterOptions,
): CommandOf<"text_typewriter"> {
  return { op: "text_typewriter", ...opts };
}
