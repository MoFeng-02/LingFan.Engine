/**
 * 执行器内部小工具。
 *
 * 都是「跨模块共用、但不属于任何单一职责」的薄函数：帧深拷贝、坐标比较、
 * 槽位名校验、菜单返回点解析、快照取值。放在一处以免各模块各写一份。
 * 只在运行层内部使用，不进包出口。
 */
import type { ColumnCoordinate } from "../../contracts";
import { Scope } from "../scope";
import type { Checkpoint, Frame } from "./frame";

/** 守卫拦截的内部标记（守卫回调抛出它 ⇒ 执行器捕获后转成 engine.error） */
export class GuardFailure extends Error {}

/** 槽位信任边界（与 Rust 侧同判）：字母数字/_/-，1..64 */
export function validSlot(slot: string): boolean {
  return slot.length > 0 && slot.length <= 64 && /^[A-Za-z0-9_-]+$/.test(slot);
}

/** 帧深拷贝：作用域链一并深拷，快照与恢复后的帧互不串扰 */
export function cloneFrame(f: Frame): Frame {
  return {
    columnId: f.columnId,
    commands: f.commands,
    index: f.index,
    scope: Scope.cloneDeep(f.scope),
    func: f.func,
    loop: f.loop
      ? {
          kind: f.loop.kind,
          cond: f.loop.cond,
          varName: f.loop.varName,
          items: f.loop.items,
          parentScope: Scope.cloneDeep(f.loop.parentScope),
          iterations: f.loop.iterations,
        }
      : undefined,
  };
}

/** 坐标相等：列相同且列内位置相同 */
export function sameCoord(a: ColumnCoordinate, b: ColumnCoordinate): boolean {
  return a.columnId === b.columnId && a.index === b.index;
}

/**
 * 解析 `__menu_return` 记账（进入 menu/ui 前记下的游戏点）。
 *
 * **fail-closed**：形状不符 ⇒ 返回 `null`（= 没有可返回的游戏进度 ⇒ 拒绝存档）。
 * 宁可拒绝也不能存出一个指向非法坐标的档（读档会炸在重放里）。
 */
export function parseMenuReturn(
  raw: unknown,
): { coord: ColumnCoordinate; waiting: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as { coord?: unknown; waiting?: unknown };
  const coord = rec.coord;
  if (typeof coord !== "object" || coord === null) return null;
  const c = coord as { columnId?: unknown; index?: unknown };
  if (typeof c.columnId !== "string" || c.columnId === "") return null;
  if (typeof c.index !== "number" || !Number.isFinite(c.index)) return null;
  return {
    coord: { columnId: c.columnId, index: Math.max(0, Math.trunc(c.index)) },
    waiting: typeof rec.waiting === "string" ? rec.waiting : "none",
  };
}

/** 快照状态中的字符串键值（缺省/非字符串 = 空串） */
export function snapshotText(cp: Checkpoint, key: string): string {
  const found = cp.snapshot.state.find(([k]) => k === key)?.[1];
  return typeof found === "string" ? found : "";
}
