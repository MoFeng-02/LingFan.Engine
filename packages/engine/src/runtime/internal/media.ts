/**
 * 媒体与动画的帧驱动接缝：宿主每帧或播放结束时回填进度。
 * 动画列表与视频命令都以状态键承载，核心只做原子更新。
 *
 * 只在运行层内部使用，不进包出口。
 */
import { SYS, type AnimationSpec, type VideoCommand } from "../../contracts";
import type { OpContext } from "./context";

export function animations(ctx: OpContext): AnimationSpec[] {
    const value = ctx.state.get(SYS.animations);
    return Array.isArray(value) ? (value as AnimationSpec[]) : [];
  }

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

export function transitionFinished(ctx: OpContext): void {
    ctx.setSystem(SYS.transition, null);
  }

export function shakeFinished(ctx: OpContext): void {
    ctx.setSystem(SYS.shake, null);
  }

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

export function reportMediaPosition(ctx: OpContext, seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) return; // 播放器噪声值忽略
    ctx.state.set(SYS.bgmPosition, seconds);
  }
