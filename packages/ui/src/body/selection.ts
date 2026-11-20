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
import {
  HOST_CAPABILITY_VALUES,
  isPlainObject,
  type HostCapability,
} from "@lingfan-engine/core";

/**
 * 读组件声明的所需能力（组件级需求声明，纯数据）。
 *
 * 组件（Vue/React 组件对象或原生工厂函数）可在自身上挂一个静态 `capabilities` 数组，
 * 声明这一屏需要宿主提供哪些通道（如 `["video"]`）。这里只读这份声明、按契约能力清单
 * 过滤合法值——不探测组件内部、不碰 DOM。未声明（或声明不是数组）一律按「无所需能力」
 * 处理，既有组件因此不受能力比对影响（契约只增、合法输入结果不变）。
 */
export function bodyCapabilitiesOf(
  component: unknown,
): readonly HostCapability[] {
  if (
    component === null ||
    (typeof component !== "object" && typeof component !== "function")
  ) {
    return [];
  }
  const declared = (component as { capabilities?: unknown }).capabilities;
  if (!Array.isArray(declared)) return [];
  const valid = new Set<string>(HOST_CAPABILITY_VALUES);
  const result: HostCapability[] = [];
  for (const value of declared) {
    if (
      typeof value === "string" &&
      valid.has(value) &&
      !result.includes(value as HostCapability)
    ) {
      result.push(value as HostCapability);
    }
  }
  return result;
}

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
