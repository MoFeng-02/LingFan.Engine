/**
 * 文本与元素实例的本地化。
 */
import type { ElementInstance } from "../../contracts/index.ts";
import type { OpContext } from "../internal/context.ts";

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
 * 翻译面覆盖所有展示文字：元素展示文字（`text` 属性）以**原文**存进 SSOT，
 * 本函数由读时派生（`derive.ts` 的 `SYS.elements` 读口）调用，按当前语言把原文译成展示值。
 * 因此切换语言后当前画面随即重新派生重译，无需重新装载；快照/存档/回溯随行的都是原文。
 * 递归 children；无 `text` 的元素只递归子级、不改 props。
 */
export function translateElements(
  ctx: OpContext,
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
