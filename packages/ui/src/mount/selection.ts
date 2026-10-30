/**
 * 挂载选择：把「可见集合」和「名字 → 组件」表合成一份可直接渲染的清单。
 *
 * 三种宿主形态的模板各写一遍「按名字取组件、取不到就跳过」的后果不是代码重复，
 * 而是同一份存档在三种宿主上挂出不同的组件集合——取不到时一种静默跳过、另一种抛错，
 * 排查起来就是三套现象。选择逻辑收在这里，模板只负责把清单铺到自己的渲染树上。
 *
 * 取不到组件一律 fail-closed：**不渲染**那一条，并**逐条上报**名字。
 * 静默跳过是这里最坏的选项——作者写了 `mount hub true` 却没看见组件，无从下手；
 * 抛错则会让一个笔误黑掉整屏。上报走注入的回调，宿主决定写错误条还是打控制台。
 */
import { isMountTable } from "@lingfan-engine/core";
import { mountProps, visibleMounts } from "./projection.ts";

/** 一条可渲染的挂载：名字、组件本身、完整入参 */
export interface MountSelection {
  /** UI 名（= `src/ui/` 下的目录名，也是 `SYS.mounts` 的键） */
  readonly name: string;
  /** 组件：Vue / React 形态是组件对象，原生形态是工厂函数；本域不解释它 */
  readonly component: unknown;
  /** 该 UI 这一帧的完整入参（不可见时不会有这一条） */
  readonly props: Readonly<Record<string, unknown>>;
}

/**
 * 算出这一帧该渲染哪些 UI。
 *
 * @param raw `SYS.mounts` 的原始值（脏值按空表，不抛）
 * @param table 「名字 → 组件」表（生成物 `uis`）
 * @param onMissing 取不到组件时的上报口；缺省只静默跳过（不建议——见文件头）
 */
export function selectMounts(
  raw: unknown,
  table: Readonly<Record<string, unknown>>,
  onMissing?: (name: string) => void,
): readonly MountSelection[] {
  const out: MountSelection[] = [];
  for (const name of visibleMounts(raw)) {
    const component = table[name];
    if (component === undefined) {
      onMissing?.(name);
      continue;
    }
    out.push({ name, component, props: mountProps(raw, name) ?? {} });
  }
  return out;
}

/**
 * 表里没有这个名字的可见 UI 名单（宿主用它做一次性诊断，避免每帧重复上报）。
 *
 * `selectMounts` 的 `onMissing` 是逐帧回调，命令式宿主适合直接接；
 * 声明式宿主按帧重渲染，重复上报会刷屏——用它算「稳定差集」再自己决定上报时机。
 */
export function missingMounts(
  raw: unknown,
  table: Readonly<Record<string, unknown>>,
): readonly string[] {
  if (!isMountTable(raw)) return [];
  return visibleMounts(raw).filter((name) => table[name] === undefined);
}
