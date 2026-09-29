/**
 * T08-04 扩展 op 面合并（锚点: editor-dynamic-op-schema）：**纯函数**产出扩展集，
 * 不修改 `OP_SCHEMAS`/`OP_META` 常量本体——消费方（表单/校验/组件面板/遍历器）改读合并面。
 * 扩展声明形状 = 引擎契约 `OpEditorSchema`（载体：label/group + zod 负载 schema）；
 * op 名冲突不可能（引擎注册期查重先抛），此处只做聚合。
 */

import type { z } from "zod";
import type { OpExtension } from "@lingfan/engine";
import type { OpMeta } from "../contracts";
import { OP_META } from "./catalog";
import { OP_GROUP_ORDER } from "./elementPalette";
import { OP_SCHEMAS } from "./opSchemas";

/** op 校验/呈现面：内建 = 常量本体；扩展注册后 = 合并集（消费方唯一读取口径） */
export interface OpSurface {
  readonly schemas: Readonly<Record<string, z.ZodType>>;
  readonly meta: readonly OpMeta[];
}

export const BUILTIN_OP_SURFACE: OpSurface = { schemas: OP_SCHEMAS, meta: OP_META };

/** 合并扩展负载 schema（`OpEditorSchema.schema` 以 unknown 载体声明，编辑器窄化为 zod） */
export function mergeOpSchemas(
  base: Readonly<Record<string, z.ZodType>>,
  extensions: readonly OpExtension[],
): Record<string, z.ZodType> {
  const merged = { ...base };
  for (const extension of extensions) {
    for (const definition of extension.ops ?? []) {
      if (definition.schema !== undefined) {
        merged[definition.op] = definition.schema.schema as z.ZodType;
      }
    }
  }
  return merged;
}

/** 合并扩展 op 元数据（标签/归组；追加保序——面板分组渲染按 OP_GROUP_ORDER 归位）。
 * 归组非法（不在 OP_GROUP_ORDER 八组内）= 扩展声明违约 → **装配期 fail-fast 抛错**（带定位），
 * 与引擎注册期校验同精神——静默丢弃会让扩展 op 从面板消失（不诚实）。 */
export function mergeOpMeta(
  base: readonly OpMeta[],
  extensions: readonly OpExtension[],
): OpMeta[] {
  const additions: OpMeta[] = [];
  for (const extension of extensions) {
    for (const definition of extension.ops ?? []) {
      const declared = definition.schema;
      if (declared === undefined) continue;
      if (!OP_GROUP_ORDER.includes(declared.group as never)) {
        throw new Error(
          `扩展「${extension.id}」的 op「${definition.op}」归组不合法：${String(
            declared.group,
          )}（须为 ${OP_GROUP_ORDER.join(" / ")} 之一）`,
        );
      }
      additions.push({
        op: definition.op,
        label: declared.label,
        group: declared.group as OpMeta["group"],
      });
    }
  }
  return [...base, ...additions];
}

/** 组合根入口：内建面 + 扩展 → 合并面（缺省扩展 = 内建面原样） */
export function mergeOpSurface(
  extensions: readonly OpExtension[],
  base: OpSurface = BUILTIN_OP_SURFACE,
): OpSurface {
  return {
    schemas: mergeOpSchemas(base.schemas, extensions),
    meta: mergeOpMeta(base.meta, extensions),
  };
}
