/**
 * 文本与元素实例的本地化。
 */
import type { ElementInstance } from "../../contracts";
import type { OpContext } from "../internal";

/**
 * Translate：命中即用译文（含空串译文），未命中/
 * 无 overlay 回退原文；空原文直返。调用点必须**先于插值**——overlay 键可含 {var} 占位符
 * （插值在译文上进行）。
 */
export function translate(ctx: OpContext, original: string): string {
  if (original === "" || ctx.overlay === null) return original;
  const hit = ctx.overlay.get(original);
  return hit === undefined ? original : hit;
}

/**
 * 翻译面覆盖所有展示文字：元素展示文字（`text` 属性）
 * 在**装载时**翻译——进 SSOT 的即译文（随快照/存档/回溯随行）；切换语言后当前画面不重翻
 * （与 menu 挂接同语义：下次 Translate 生效），再次进列重新装载时生效。递归 children。
 * 无 `text` 的元素原样返回（引用不变，不触发无谓的 ValueChanged 噪声之外的对象复制）。
 */
export function translateElements(ctx: OpContext, 
  instances: readonly ElementInstance[],
): ElementInstance[] {
  return instances.map((instance) => {
    const raw = instance.props.text;
    const props =
      typeof raw === "string"
        ? { ...instance.props, text: ctx.translate(raw) }
        : instance.props;
    return {
      ...instance,
      props,
      children: ctx.translateElements(instance.children ?? []),
    };
  });
}
