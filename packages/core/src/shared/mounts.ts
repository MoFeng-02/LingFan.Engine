/**
 * 挂载表的读入判据：把运行期到手的 `unknown` 收窄成契约里的挂载表。
 *
 * 契约层只声明形态，挂载表却可能来自存档、来自被改坏的工程文件，
 * 所以每次读入都得先判后用（与 `audio.ts` 的实例表同一套纪律：判不过就由调用方
 * fail-closed，这里不抛错也不猜默认值）。
 *
 * 三条规则一次判清，缺一条都会让坏数据漏进渲染层：
 * - 表是普通对象（数组与 `null` 不算——数组会把下标当 UI 名）
 * - 键合 UI 名形态（名字同时是宿主预加载键与目录名，形态必须统一）
 * - 值只有 `visible: boolean` 与 `props: 普通对象` 两项
 */
import type { MountEntry, MountTable } from "../contracts/runtime/index.ts";
import { isPlainObject } from "./guards.ts";
import { isUiName } from "./ui-name.ts";

/** 是否是合形态的挂载记录 */
export function isMountEntry(value: unknown): value is MountEntry {
  if (!isPlainObject(value)) return false;
  if (typeof value.visible !== "boolean") return false;
  return isPlainObject(value.props);
}

/** 是否是合形态的挂载表：普通对象 + 键合 UI 名 + 值合记录 */
export function isMountTable(value: unknown): value is MountTable {
  if (!isPlainObject(value)) return false;
  for (const name of Object.keys(value)) {
    if (!isUiName(name)) return false;
    if (!isMountEntry(value[name])) return false;
  }
  return true;
}

/**
 * 取挂载表的 UI 名清单（码点序）：不合形态的表按空表处理。
 *
 * 渲染层按名字排序后下发才能保证「同一份状态 → 同一串挂载动作」，
 * 否则对象键序会让同一存档在两台机器上挂出不同顺序的组件。
 */
export function mountNames(value: unknown): readonly string[] {
  return isMountTable(value) ? Object.keys(value).sort() : [];
}
