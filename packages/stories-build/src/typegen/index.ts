/**
 * 类型面生成器出口（唯一出口）。
 *
 * 生成物落 `src/gen/stories.gen.d.ts`：列名与插值键在此收窄为字面量联合类型，
 * 拼错列名/插值键在 IDE 与 `tsc --noEmit` 阶段即红，而不是等运行期才发现。
 */
export { collectDeclaredNames } from "./collect.ts";
export {
  collectEnumTypeSlots,
  collectEnumTypeSlotsForBuild,
} from "./state-enum-ast.ts";
export type { EnumSlotBuildInput, EnumTypeSlot } from "./state-enum-ast.ts";
export { renderStateTypegen } from "./state-render.ts";
export type { StateTypegenInput } from "./state-render.ts";
export { renderScriptTypegen } from "./script-render.ts";
export { renderFontTypegen } from "./font-render.ts";
export { renderTypegen } from "./render.ts";
export type { TypegenInput } from "./types.ts";
