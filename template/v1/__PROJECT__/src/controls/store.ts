/**
 * 宿主控制面的宿主侧副本（框架无关）。
 *
 * `bootHost` 造出控制面后经 `onControls` 交给组合根，组合根放进这里；框架形态的挂载
 * 组件订阅它拿最新句柄。与 `mountStore` 同处一层但装的东西不同：那边是故事给的值
 * （JSON 安全、随存档），这边是宿主给的操作句柄（含函数、不进快照）。
 *
 * 复用同一个单元格实现而不是另写一份订阅逻辑：形状一样（一个当前值 + 订阅），
 * 差别只在取出来时的类型，用一层薄转写把 `unknown` 收回来即可。
 */
import { createMountStore } from "@lingfan-engine/ui";
import type { HostControls } from "@lingfan-engine/core";

const cell = createMountStore();

/** 控制面单元格：`snapshot` 取当下、`subscribe` 追随变化、`set` 在组合根里喂 */
export const controlsStore = {
  /** 当下的控制面；宿主尚未交付时为 `null` */
  snapshot(): HostControls | null {
    return (cell.snapshot() ?? null) as HostControls | null;
  },
  /** 订阅变化（订阅时回放当下值由调用方自己先取一次 `snapshot`） */
  subscribe(listener: (controls: HostControls | null) => void): () => void {
    return cell.subscribe((raw) => {
      listener((raw ?? null) as HostControls | null);
    });
  },
  /** 交付控制面（组合根在 `onControls` 回调里调一次） */
  set(controls: HostControls): void {
    cell.set(controls);
  },
};
