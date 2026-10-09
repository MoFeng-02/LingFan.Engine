/**
 * 元素动画、屏幕级效果与故事级打字机设置的执行。
 *
 * 核心只写「动画描述」与「启动键」这类状态；UI 每帧插值并在播毕回调写回终值，
 * 元素表与动画队列都随快照、存档、回溯自动随行。
 */
import {
  SYS,
  type AnimationSpec,
  type ElementInstance,
  type StoryCommand,
} from "../../../contracts";
import type { OpContext } from "../../internal";

/** `animate_block` 可承载的属性（与既有实现的属性集一致） */
const ANIMATE_BLOCK_PROPS: readonly string[] = [
  "x",
  "y",
  "opacity",
  "rotation",
  "scale",
];

/**
 * 元素动画（`animate` / `animate_block`）：核心只写**动画描述**进 `SYS.animations`，
 * UI 每帧插值，播毕调 `animationFinished(seq)` 写回终值。
 *
 * - `from` 取目标元素当前属性值；非有限数字或未设 = `0`
 * - `animate_block` 的多个属性**并行**（同 duration）：JSON 键序对作者不可控，序列语义请用多条
 *   `animate` 表达（有意差异：不做序列执行）
 */
export function execAnimate(ctx: OpContext, cmd: StoryCommand): boolean {
  const target = typeof cmd.target === "string" ? cmd.target : "";
  if (target === "") {
    ctx.fail(`${cmd.op}-invalid`, `${cmd.op}.target 必须为非空目标`);
    return false;
  }
  const hits = ctx.findElements(target);
  if (hits.length === 0) {
    ctx.fail(`${cmd.op}-target-not-found`, `${cmd.op} 未命中任何元素：${target}`);
    return false;
  }
  const element = hits[0]!;
  const duration =
    typeof cmd.duration === "number" &&
    Number.isFinite(cmd.duration) &&
    cmd.duration >= 0
      ? cmd.duration
      : 0.3;
  const easing =
    typeof cmd.easing === "string" && cmd.easing !== ""
      ? cmd.easing
      : "EaseOutQuad";

  if (cmd.op === "animate") {
    const property = typeof cmd.property === "string" ? cmd.property : "";
    const value = cmd.value;
    if (
      property === "" ||
      typeof value !== "number" ||
      !Number.isFinite(value)
    ) {
      ctx.fail(
        "animate-invalid",
        "animate 需要 property（非空）与 value（有限数字）",
      );
      return false;
    }
    const spec = makeAnimation(ctx, element, property, value, duration, easing);
    ctx.setSystem(SYS.animations, [...ctx.animations(), spec]);
    return true;
  }

  // animate_block：多属性同时开始
  const specs: AnimationSpec[] = [];
  for (const property of ANIMATE_BLOCK_PROPS) {
    const value = cmd[property];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      ctx.fail(
        "animate_block-invalid",
        `animate_block.${property} 必须为有限数字`,
      );
      return false;
    }
    specs.push(makeAnimation(ctx, element, property, value, duration, easing));
  }
  if (specs.length === 0) {
    ctx.fail(
      "animate_block-invalid",
      "animate_block 至少需要一个属性（x / y / opacity / rotation / scale）",
    );
    return false;
  }
  ctx.setSystem(SYS.animations, [...ctx.animations(), ...specs]);
  return true;
}

/**
 * 屏幕级效果启动：
 * - `transition { type, duration }` → `SYS.transition`（UI 全屏遮罩动画）
 * - `shake { intensity, duration }` → `SYS.shake`（UI 抖动偏移）
 */
export function execScreenEffect(ctx: OpContext, cmd: StoryCommand): boolean {
  const duration =
    typeof cmd.duration === "number" &&
    Number.isFinite(cmd.duration) &&
    cmd.duration >= 0
      ? cmd.duration
      : 0.5;
  if (cmd.op === "transition") {
    const type = typeof cmd.type === "string" ? cmd.type : "";
    if (type === "") {
      ctx.fail("transition-invalid", "transition.type 必须为非空效果名");
      return false;
    }
    ctx.transitionSeq += 1;
    ctx.setSystem(SYS.transition, {
      type,
      duration,
      seq: ctx.transitionSeq,
    });
    return true;
  }
  const intensity =
    typeof cmd.intensity === "number" && Number.isFinite(cmd.intensity)
      ? cmd.intensity
      : 8;
  ctx.shakeSeq += 1;
  ctx.setSystem(SYS.shake, {
    intensity,
    duration,
    seq: ctx.shakeSeq,
  });
  return true;
}

/**
 * 故事级打字机设置（`text_typewriter`）：`enabled`（开关）与/或
 * `speed`（字符/秒）。与玩家偏好（独立存储）分离——偏好优先级更高，由 UI 合成。
 */
export function execTextTypewriter(
  ctx: OpContext,
  cmd: StoryCommand,
): boolean {
  const enabled = cmd.enabled;
  const speed = cmd.speed;
  if (enabled !== undefined && typeof enabled !== "boolean") {
    ctx.fail("text_typewriter-invalid", "text_typewriter.enabled 必须为布尔");
    return false;
  }
  if (
    speed !== undefined &&
    (typeof speed !== "number" || !Number.isFinite(speed) || speed <= 0)
  ) {
    ctx.fail(
      "text_typewriter-invalid",
      "text_typewriter.speed 必须为正数（字符/秒）",
    );
    return false;
  }
  if (enabled === undefined && speed === undefined) {
    ctx.fail(
      "text_typewriter-invalid",
      "text_typewriter 至少需要 enabled 或 speed",
    );
    return false;
  }
  const next: Record<string, unknown> = {};
  if (enabled !== undefined) next.enabled = enabled;
  if (speed !== undefined) next.speed = speed;
  ctx.setSystem(SYS.typewriter, next);
  return true;
}

/** 构造动画描述（`from` 取元素当前值，缺省 0）；`target` 固化为元素 id，避免回溯后寻址漂移 */
function makeAnimation(
  ctx: OpContext,
  element: ElementInstance,
  property: string,
  to: number,
  duration: number,
  easing: string,
): AnimationSpec {
  const raw = element.props[property];
  const from = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  ctx.animationSeq += 1;
  return {
    target: element.id,
    property,
    from,
    to,
    duration,
    easing,
    seq: ctx.animationSeq,
  };
}
