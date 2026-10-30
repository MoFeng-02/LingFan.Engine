/**
 * 挂载表投影：把 `SYS.mounts` 的原始值变成「该渲染哪些 UI、各自带什么入参」。
 *
 * 三种宿主形态（原生 DOM / Vue / React）共用这一份判定。各写一份的后果不是代码重复，
 * 而是同一份存档在三种宿主上挂出不同的组件——「三形态行为一致」正是靠这里成面的。
 *
 * 表可能来自存档，也可能被改坏（存档是用户可编辑的 JSON）。所以一律先判后用：
 * 判不过按空表处理，渲染层照常工作——少挂一个 UI 比整屏白掉好，这里不抛错。
 *
 * 形态定义不在这里：`MountEntry` / `MountTable` 由引擎契约给出，展示层只消费。
 */
import {
  isMountTable,
  mountNames,
  type MountEntry,
  type MountTable,
} from "@lingfan-engine/core";

export type { MountEntry, MountTable };

/**
 * 从 SSOT 原始值投影出可见集合（脏值按空表，不卡死渲染）。
 *
 * 顺序是码点序而非对象键序：同一份状态必须投影出同一串挂载动作，
 * 否则两台机器上的同一存档会挂出不同顺序的组件。
 */
export function visibleMounts(raw: unknown): readonly string[] {
  if (!isMountTable(raw)) return [];
  return mountNames(raw).filter((name) => raw[name].visible === true);
}

/**
 * 取某 UI 的完整挂载记录：不可见或没有这条记录时返回 `undefined`。
 *
 * 宿主一次拿全（显隐 + 入参），不必为同一个名字判两遍——判两遍就有两次不一致的机会。
 */
export function mountEntryOf(
  raw: unknown,
  name: string,
): MountEntry | undefined {
  if (!isMountTable(raw)) return undefined;
  const entry: MountEntry | undefined = raw[name];
  if (entry === undefined || !entry.visible) return undefined;
  return entry;
}

/**
 * 取某 UI 的 props：不可见时返回 `undefined`。
 *
 * 返回的是记录里的那一份引用，不是拷贝——调用方只读。要改就整表新建（写时复制）。
 */
export function mountProps(
  raw: unknown,
  name: string,
): Readonly<Record<string, unknown>> | undefined {
  return mountEntryOf(raw, name)?.props;
}
