/**
 * 定时器端口：把「延迟回调」与「取消回调」从宿主全局 `setTimeout`/`clearTimeout`
 * 收敛为可注入端口。引擎与偏好状态的定时面全部经此端口取用：
 * - 组合根不注入时 = 内建 `hostTimer`（宿主全局定时器，行为与直接调用一致）；
 * - 无 JS 运行时的宿主（原生编译目标）注入自己的实现即可，核心零平台猜测。
 *
 * 句柄为不透明类型（品牌化）：除经端口返回的句柄外不可伪造。
 */

/** 定时器句柄（不透明）：由 {@link TimerPort.set} 返回，只能交回 {@link TimerPort.clear} */
export type TimerHandle = { readonly brand: unique symbol };

/** 定时器端口：延迟回调 + 取消。实现方保证句柄不可跨实例混用。 */
export interface TimerPort {
  /** 安排 `ms` 毫秒后回调 `fn`；返回取消句柄 */
  set(fn: () => void, ms: number): TimerHandle;
  /** 取消已安排的回调；句柄已触发或已取消时为空操作 */
  clear(handle: TimerHandle): void;
}

/**
 * 内建兜底实现：宿主全局 `setTimeout`/`clearTimeout`。
 * 组合根不注入 TimerPort 时的缺省——行为与直接调用宿主定时器完全一致。
 */
export const hostTimer: TimerPort = {
  set(fn, ms) {
    return globalThis.setTimeout(fn, ms) as unknown as TimerHandle;
  },
  clear(handle) {
    globalThis.clearTimeout(handle as unknown as number);
  },
};
