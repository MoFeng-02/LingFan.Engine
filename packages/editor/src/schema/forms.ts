/**
 * 06-D2 表单描述符派生：字段类型/必填/可选值/默认值取自 Zod schema（唯一事实源），
 * 标签/呈现语义取自 catalog；两者经互锁测试锁定字段名集合一致。
 * 锚点: schema-driven-forms
 */

import type { z } from "zod";
import type {
  FieldDescriptor,
  FieldKind,
  OpFormDescriptor,
  OpMeta,
} from "../contracts";
import { FIELD_META } from "./catalog";
import { elementLabel } from "./elementForms";
import { BUILTIN_OP_SURFACE, type OpSurface } from "./surface";

interface Unwrapped {
  inner: z.ZodType;
  required: boolean;
  hasDefault: boolean;
  defaultValue?: unknown;
}

function unwrap(schema: z.ZodType): Unwrapped {
  let inner: z.ZodType = schema;
  let required = true;
  let hasDefault = false;
  let defaultValue: unknown;
  for (;;) {
    const type = inner.def.type;
    if (type === "optional") {
      required = false;
      inner = (inner.def as z.core.$ZodOptionalDef).innerType as z.ZodType;
      continue;
    }
    if (type === "default") {
      const def = inner.def as z.core.$ZodDefaultDef;
      hasDefault = true;
      defaultValue = def.defaultValue;
      inner = def.innerType as z.ZodType;
      continue;
    }
    return { inner, required, hasDefault, defaultValue };
  }
}

function enumValuesOf(def: z.core.$ZodEnumDef): string[] {
  const values = Array.isArray(def.entries)
    ? def.entries
    : Object.values(def.entries);
  return values.map(String);
}

function describeField(
  key: string,
  schema: z.ZodType,
  metaKey: string,
): FieldDescriptor {
  const { inner, required, hasDefault, defaultValue } = unwrap(schema);
  const meta = FIELD_META[metaKey];
  const base: FieldDescriptor = {
    key,
    label: meta?.label ?? key,
    kind: meta?.kind ?? "string",
    required,
    hasDefault,
    ...(hasDefault ? { defaultValue } : {}),
  };
  switch (inner.def.type) {
    case "enum":
      return {
        ...base,
        kind: "enum",
        enumValues: enumValuesOf(inner.def as z.core.$ZodEnumDef),
      };
    case "tuple": {
      const items = (inner.def as z.core.$ZodTupleDef).items;
      return {
        ...base,
        kind: meta?.kind ?? "tuple",
        tupleItems: items.map((item, index) =>
          describeField(`${key}[${index}]`, item as z.ZodType, metaKey),
        ),
      };
    }
    case "array": {
      const element = (inner.def as z.core.$ZodArrayDef).element as z.ZodType;
      const itemObject =
        element.def.type === "object"
          ? describeField(`${key}[]`, element, `${metaKey}[]`)
          : undefined;
      return {
        ...base,
        kind: meta?.kind ?? "array",
        ...(itemObject ? { item: itemObject } : {}),
      };
    }
    case "object": {
      const shape = (inner.def as z.core.$ZodObjectDef).shape;
      return {
        ...base,
        kind: meta?.kind ?? "object",
        properties: Object.entries(shape).map(([childKey, childSchema]) =>
          describeField(
            childKey,
            childSchema as z.ZodType,
            `${metaKey}.${childKey}`,
          ),
        ),
      };
    }
    case "unknown":
      return { ...base, kind: meta?.kind ?? "value" };
    case "record":
      return { ...base, kind: meta?.kind ?? "object" };
    // T08-04 扩展 op 无 FIELD_META → 从 zod 派生兜底（meta 恒优先，内建 op 行为不变）
    case "number":
      return { ...base, kind: meta?.kind ?? "number" };
    case "boolean":
      return { ...base, kind: meta?.kind ?? "boolean" };
    default:
      return base;
  }
}

/** 单 op 表单描述符；未知 op 返回 undefined（诊断层报 unknown-op）。
 * `surface`（T08-04，可选）= op 面（缺省内建；扩展注册后由组合根传合并面）。 */
export function describeForm(
  op: string,
  surface: OpSurface = BUILTIN_OP_SURFACE,
): OpFormDescriptor | undefined {
  const schema = surface.schemas[op];
  const meta = surface.meta.find((entry) => entry.op === op);
  if (schema === undefined || meta === undefined) return undefined;
  const shape = (schema.def as z.core.$ZodObjectDef).shape;
  return {
    op,
    label: meta.label,
    group: meta.group,
    fields: Object.entries(shape).map(([key, childSchema]) =>
      describeField(key, childSchema as z.ZodType, `${op}.${key}`),
    ),
  };
}

/** op 目录（时间线插入菜单/节点图调色板用；`surface` = T08-04 合并面，缺省内建） */
export function listOps(surface: OpSurface = BUILTIN_OP_SURFACE): readonly OpMeta[] {
  return surface.meta;
}

/**
 * 行标签（时间线/命令体列表共用，单一事实源）：
 * 命令取 op 标签；**元素取元素类型标签**（元素没有 `op`——按 op 取会让整个元素层显示「（坏命令）」）；
 * 两者都不是才是真正无法识别的节点。
 */
export function describeNodeLabel(
  node: Record<string, unknown> | undefined,
  surface: OpSurface = BUILTIN_OP_SURFACE,
): string {
  const op = node?.op;
  if (typeof op === "string") return describeForm(op, surface)?.label ?? op;
  const type = node?.type;
  if (typeof type === "string") return elementLabel(type);
  return "（坏命令）";
}

/**
 * 表单控件的原始文本 → 落树值（06-D2 的 kind 语义，与 `describeField` 同域故放此处）。
 *
 * - `number`/`integer`：`Number`（NaN 由诊断层兜）
 * - `boolean`：字面 `"true"`
 * - `value`：智能字面量——`true`/`false`/纯数字还原为对应类型，其余保持字符串（`{expr}` 等）
 * - 其余（string/identifier/resource/expression/text…）：原样字符串
 *
 * **注意 `value` 的智能还原**：`x`/`width` 这类「数字或 CSS 长度」字段靠它把 `120`
 * 还原为数字（运行时 `len()` 才会补 `px`；退化成字符串 `"120"` 会被 CSS 判为非法而静默丢弃）。
 */
export function coerceFieldValue(kind: FieldKind, raw: string): unknown {
  switch (kind) {
    case "number":
    case "integer":
      return Number(raw);
    case "boolean":
      return raw === "true";
    case "value":
      if (raw === "true") return true;
      if (raw === "false") return false;
      if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
      return raw;
    default:
      return raw;
  }
}
