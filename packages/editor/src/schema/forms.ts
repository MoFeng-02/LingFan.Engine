/**
 * 06-D2 表单描述符派生：字段类型/必填/可选值/默认值取自 Zod schema（唯一事实源），
 * 标签/呈现语义取自 catalog；两者经互锁测试锁定字段名集合一致。
 * 锚点: schema-driven-forms
 */

import type { z } from "zod";
import type { FieldDescriptor, OpFormDescriptor } from "../contracts";
import { FIELD_META, OP_META } from "./catalog";
import { OP_SCHEMAS } from "./opSchemas";

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
    default:
      return base;
  }
}

/** 单 op 表单描述符；未知 op 返回 undefined（诊断层报 unknown-op） */
export function describeForm(op: string): OpFormDescriptor | undefined {
  const schema = OP_SCHEMAS[op];
  const meta = OP_META.find((entry) => entry.op === op);
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

/** op 目录（时间线插入菜单/节点图调色板用） */
export function listOps(): typeof OP_META {
  return OP_META;
}
