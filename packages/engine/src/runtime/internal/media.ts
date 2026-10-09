/**
 * 媒体与动画的帧驱动接缝：宿主每帧或播放结束时回填进度。
 * 动画列表与视频命令都以状态键承载，核心只做原子更新。
 *
 * 只在运行层内部使用，不进包出口。
 */
import { SYS, type AnimationSpec, type VideoCommand } from "../../contracts";
import type { OpContext } from "./context";

/** 帧驱动消费侧接缝：界面每帧读取，或播毕后回调。 */

/** 动画队列（界面每帧按 elapsed 插值应用到舞台，不逐帧写状态容器） */
export function animations(ctx: OpContext): AnimationSpec[] {
  const value = ctx.state.get(SYS.animations);
  return Array.isArray(value) ? (value as AnimationSpec[]) : [];
}

/**
 * 动画播毕：把终值写回元素 `props` 并移除该条目 ——
 * 使快照、存档与回溯看到的是终态而非中间值。
 */
export function animationFinished(ctx: OpContext, seq: number): void {
  const list = ctx.animations();
  const done = list.filter((a) => a.seq === seq);
  if (done.length === 0) return;
  ctx.setSystem(
    SYS.animations,
    list.filter((a) => a.seq !== seq),
  );
  ctx.setSystem(
    SYS.elements,
    ctx.mapElements((el) => {
      const settle = done.filter((a) => a.target === el.id);
      if (settle.length === 0) return el;
      const props = { ...el.props };
      for (const a of settle) props[a.property] = a.to;
      return { ...el, props };
    }),
  );
}

/** 转场播毕：清除启动键 */
export function transitionFinished(ctx: OpContext): void {
  ctx.setSystem(SYS.transition, null);
}

/** 震动播毕：清除启动键 */
export function shakeFinished(ctx: OpContext): void {
  ctx.setSystem(SYS.shake, null);
}

/**
 * 过场完成：解除视频等待，故事继续（检查点在过场建立时已提交，重放不再重看）。
 * 非视频等待期调用 fail-closed。
 */
export function videoFinished(ctx: OpContext): void {
  if (ctx.get(SYS.waiting) !== "video") {
    ctx.fail("video-finish-invalid", "当前不在视频等待中");
    return;
  }
  // 过场结束即收起视频层（与「跳过」路径对称）：视频层实例 z 常高于对话层，
  // 不收起会继续盖住对话与 HUD（点击因 pointer-events:none 仍可穿透，界面看似卡死）
  ctx.videoSeq += 1;
  ctx.setSystem(SYS.video, {
    kind: "stop",
    seq: ctx.videoSeq,
  } satisfies VideoCommand);
  ctx.setSystem(SYS.waiting, "none");
  ctx.liveCheckpointed = false; // live 已越过该检查点
  ctx.run();
}

/**
 * 媒体播放位置回写（界面每帧轮询播放器时调用）。
 * 帧级键静默写：不进事件流（防事件风暴），但随快照与存档持久化（读档续播）。
 */
export function reportMediaPosition(ctx: OpContext, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < 0) return; // 播放器噪声值忽略
  ctx.state.set(SYS.bgmPosition, seconds);
}
