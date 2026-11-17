/**
 * I18N 展示值派生：状态原值 → 当前语言展示值的唯一派生点。
 *
 * 派生键集合只在 `I18N_DERIVED_KEYS` 声明一次；读口/出站对状态原值调用
 * `deriveValue(ctx, key, rawStateValue)` 得到当前语言的展示值。
 * 非派生键、未装配译文表（overlay 为 null）一律原值返回（引用不变）。
 *
 * 注意：派生是纯读——不写状态、不改原值；元素实例的 props.text 递归翻译
 * 复用 `translateElements`，输入候选只译展示 text、提交 value 原样保留。
 */
import { SYS, type ElementInstance } from "../../contracts/index.ts";
import type { OpContext } from "../internal/context.ts";
import { translate, translateElements } from "./translate.ts";

/** 展示值随当前语言派生的状态键（唯一声明点；其余键状态里是什么就展示什么） */
export const I18N_DERIVED_KEYS: ReadonlySet<string> = new Set([
  SYS.currentDialogText,
  SYS.currentDialogSpeaker,
  SYS.menuPrompt,
  SYS.menuOptions,
  SYS.inputPrompt,
  SYS.inputOptions,
  SYS.nvlBuffer,
  SYS.elements,
]);

/**
 * 派生单个状态键的展示值：
 * 非派生键或 overlay 未装配 → 原值；派生键 → 按值形状翻译后的新值。
 * 字符串表面逐条查表；文本列表逐条查表；输入候选只译 text；元素递归译 props.text。
 * 形状不符的值（不应出现，防御老存档/异常写入）原样返回，不抛错。
 */
export function deriveValue(
  ctx: OpContext,
  key: string,
  rawStateValue: unknown,
): unknown {
  if (!I18N_DERIVED_KEYS.has(key) || ctx.overlay === null) return rawStateValue;
  switch (key) {
    case SYS.currentDialogText:
    case SYS.currentDialogSpeaker:
    case SYS.menuPrompt:
    case SYS.inputPrompt:
      return typeof rawStateValue === "string"
        ? translate(ctx, rawStateValue)
        : rawStateValue;
    case SYS.menuOptions:
    case SYS.nvlBuffer:
      return deriveTextList(ctx, rawStateValue);
    case SYS.inputOptions:
      return deriveInputOptions(ctx, rawStateValue);
    case SYS.elements:
      // 形状在元素 op 执行期已校验（与状态读口同一口径），此处只防非数组
      return Array.isArray(rawStateValue)
        ? translateElements(ctx, rawStateValue as ElementInstance[])
        : rawStateValue;
    default:
      return rawStateValue;
  }
}

/** 文本列表（menuOptions / nvlBuffer）：逐条翻译字符串项，非字符串项原样保留 */
function deriveTextList(ctx: OpContext, value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((line: unknown) =>
    typeof line === "string" ? translate(ctx, line) : line,
  );
}

/** 输入候选（inputOptions）：只译展示 text；value 是提交值不是展示文字，不查表 */
function deriveInputOptions(ctx: OpContext, value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item: unknown) => {
    if (typeof item !== "object" || item === null) return item;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.text !== "string") return item;
    return { ...candidate, text: translate(ctx, candidate.text) };
  });
}
