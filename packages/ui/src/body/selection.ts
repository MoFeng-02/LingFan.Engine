/**
 * 身体选择：把 `SYS.body` 的原始值与「名字 → 组件」表合成一份可直接渲染的结果。
 *
 * 与挂载选择是两条通道：`mounts` 是叠加的 UI 表（可多个、可显隐），`body` 是
 * 「这一屏由谁画」的单槽——所以这里返回单个结果，而不是清单。
 *
 * 三种宿主形态（原生 DOM / Vue / React）各写一遍「按名字取组件、取不到怎么办」的后果
 * 不是代码重复，而是同一份存档在三种宿主上渲染出不同的画面。选择逻辑收在这里，
 * 宿主只负责把结果铺到自己的渲染树上。
 *
 * 判不过的输入分两类，处理方式不同：
 * - **形状不对**（`{ name: string; props?: object }` 之外的一切）：不查表、不上报，
 *   返回 `null`。这不是「作者要的组件找不到」，而是状态本身坏了——该报的错误归
 *   读状态的一方（进列装载时那条路径），这里再报一次只会造成两处真相。
 * - **形状对但表里没有这个名字**：fail-closed，返回 `null` 并上报名字。
 *   静默跳过是这里最坏的选项——作者写了 body 却没看见组件，无从下手；抛错则会让
 *   一个笔误黑掉整屏。上报口由宿主注入，写错误条还是打控制台归宿主决定。
 */
import { isPlainObject } from "@lingfan-engine/core";

/** 一条可渲染的身体：名字、组件本身、完整入参 */
export interface BodySelection {
  /** 组件名（= `src/scenes/` 下的目录名，也是 `SYS.body.name`） */
  readonly name: string;
  /** 组件：Vue / React 形态是组件对象，原生形态是工厂函数；本域不解释它 */
  readonly component: unknown;
  /** 该组件这一屏的入参（声明里没写 `props` 时是空对象） */
  readonly props: Readonly<Record<string, unknown>>;
}

/**
 * 从 `SYS.body` 的原始值选出这一屏要渲染的组件。
 *
 * 键不存在（无身体的列）与脏数据都返回 `null`——对宿主而言两者表现一致：不渲染身体。
 *
 * @param raw `SYS.body` 的原始值（可能来自存档，形状不可信）
 * @param table 「名字 → 组件」表（宿主生成物 `scenes`）
 * @param onMissing 表里缺这个组件时的上报口；缺省只返回 `null`
 */
export function selectBody(
  raw: unknown,
  table: Readonly<Record<string, unknown>>,
  onMissing?: (name: string) => void,
): BodySelection | null {
  if (!isPlainObject(raw)) return null;
  const name = raw.name;
  if (typeof name !== "string") return null;
  const props = raw.props;
  if (props !== undefined && !isPlainObject(props)) return null;

  const component = table[name];
  if (component === undefined) {
    onMissing?.(name);
    return null;
  }
  return { name, component, props: props ?? {} };
}
