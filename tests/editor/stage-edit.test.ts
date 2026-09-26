/**
 * 06 §一.1 舞台编辑测试（元素表单描述符 + 拖拽坐标）。
 * 锚点: schema-driven-forms / element-form-contract-lock / stage-drag-position
 *
 * 测试纪律五类齐备：
 * - 互锁：表单字段面 ↔ 引擎元素契约（ELEMENT_ATTRIBUTES ∪ {id,name}）
 * - 回归锚定：36 类型全覆盖、字段顺序确定性
 * - 故意错误：未知类型 fail-closed
 * - 边界：字符串坐标（百分比）不参与像素拖拽
 * - 拟态旅程：作者先命名（id/name 在字段表最前）再摆位
 */
import { describe, expect, it } from "vitest";
import {
  coerceFieldValue,
  describeElement,
  describeForm,
  describeNodeLabel,
  draggedPosition,
  elementLabel,
  listElementTypes,
  listOps,
  parseNumericPosition,
  specificAttrsOf,
  validateStory,
  type FieldDescriptor,
} from "@lingfan/editor";
import { ELEMENT_ATTRIBUTES, ELEMENT_TYPES } from "@lingfan/engine";
import { sampleStory } from "../../apps/editor/src/sample";
import fieldRowSource from "../../apps/editor/src/components/FieldRow.vue?raw";

describe("元素表单描述符（锚点: schema-driven-forms）", () => {
  it("36 类型全覆盖；未知类型 fail-closed（故意错误）", () => {
    for (const type of ELEMENT_TYPES) {
      const descriptor = describeElement(type);
      expect(descriptor, type).toBeDefined();
      expect(descriptor?.type).toBe(type);
      expect(descriptor?.label).not.toBe("");
      expect(descriptor?.fields.length).toBeGreaterThan(0);
    }
    expect(describeElement("teleporter")).toBeUndefined();
    expect(listElementTypes()).toHaveLength(36);
  });

  it("字段面互锁：全部落在 ELEMENT_ATTRIBUTES ∪ {id,name} 内，且一律可选", () => {
    const allowed = new Set<string>([...ELEMENT_ATTRIBUTES, "id", "name"]);
    for (const type of ELEMENT_TYPES) {
      for (const field of describeElement(type)?.fields ?? []) {
        expect(allowed.has(field.key), `${type}.${field.key}`).toBe(true);
        // 元素属性一律可选（`type` 是结构字段，不进表单）
        expect(field.required, `${type}.${field.key}`).toBe(false);
      }
    }
  });

  it("通用属性全集不漏字段（含结构字段 id/name）", () => {
    const keys = new Set(
      (describeElement("text")?.fields ?? []).map((f) => f.key),
    );
    for (const attr of ELEMENT_ATTRIBUTES) {
      expect(keys.has(attr), attr).toBe(true);
    }
    expect(keys.has("id")).toBe(true);
    expect(keys.has("name")).toBe(true);
  });

  it("关键字段的 kind 驱动控件选型", () => {
    const byKey = new Map(
      (describeElement("button")?.fields ?? []).map((f) => [f.key, f]),
    );
    expect(byKey.get("opacity")?.kind).toBe("number");
    expect(byKey.get("visible")?.kind).toBe("boolean");
    expect(byKey.get("nav")?.kind).toBe("identifier");
    expect(byKey.get("source")?.kind).toBe("resource");
    expect(byKey.get("text")?.kind).toBe("text");
    expect(byKey.get("disabled")?.kind).toBe("boolean");
  });

  it("分类型属性与中文标签可用（回归锚定）", () => {
    expect(specificAttrsOf("slider")).toEqual(["min", "max", "orientation"]);
    expect(specificAttrsOf("checkbox")).toEqual(["checked"]);
    expect(specificAttrsOf("vbox")).toEqual(["direction", "spacing"]);
    expect(elementLabel("vbar")).toBe("纵向进度条");
    expect(elementLabel("panel")).toBe("面板");
  });

  it("字段顺序确定性：id/name 在最前（拟态旅程：先命名再摆位）", () => {
    const first = (describeElement("panel")?.fields ?? []).map((f) => f.key);
    expect(first.slice(0, 2)).toEqual(["id", "name"]);
    const second = (describeElement("panel")?.fields ?? []).map((f) => f.key);
    expect(second).toEqual(first);
  });
});

describe("拖拽坐标（锚点: stage-drag-position）", () => {
  it("数字坐标参与像素位移，四舍五入到整数", () => {
    expect(draggedPosition(40, 12.6)).toBe(53);
    expect(draggedPosition(40, -8.4)).toBe(32);
  });

  it("缺失坐标从 0 起算（边界）", () => {
    expect(draggedPosition(undefined, 30)).toBe(30);
    expect(draggedPosition(null, 30)).toBe(30);
  });

  it("字符串坐标（百分比等）不参与拖拽 → null，调用方保持原值（边界）", () => {
    expect(draggedPosition("50%", 10)).toBeNull();
    expect(draggedPosition("calc(100% - 8px)", 10)).toBeNull();
    expect(draggedPosition("", 10)).toBe(10); // 空串等同缺失
  });

  it("parseNumericPosition 只认有限数字", () => {
    expect(parseNumericPosition(12)).toBe(12);
    expect(parseNumericPosition("12")).toBeNull();
    expect(parseNumericPosition(Number.NaN)).toBeNull();
    expect(parseNumericPosition(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("编辑期元素校验（锚点: edit-time-validation）", () => {
  it("示例故事（含 scene 列）零诊断（回归锚定：打开编辑器不应一片红）", () => {
    expect(validateStory(sampleStory())).toEqual([]);
  });

  it("元素不再被误当命令（回归锚定：旧遍历会报 unknown-op）", () => {
    const diagnostics = validateStory(sampleStory());
    expect(diagnostics.some((d) => d.code === "unknown-op")).toBe(false);
  });

  it("非法元素 → invalid-element 且带精确 JSON Pointer（故意错误）", () => {
    const diagnostics = validateStory({
      formatVersion: 1,
      id: "d",
      entry: "s",
      columns: [
        {
          id: "s",
          kind: "scene",
          elements: [
            { type: "teleporter" }, // 未知类型
            { type: "text", nope: 1 }, // 未知属性
            { type: "text", children: [] }, // 非容器带 children
          ],
        },
      ],
    });
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.every((d) => d.code === "invalid-element")).toBe(true);
    expect(diagnostics.map((d) => d.pointer)).toEqual([
      "/columns/0/elements/0",
      "/columns/0/elements/1",
      "/columns/0/elements/2",
    ]);
  });

  it("嵌套子元素递归校验（边界）", () => {
    const diagnostics = validateStory({
      formatVersion: 1,
      id: "d",
      entry: "s",
      columns: [
        {
          id: "s",
          kind: "scene",
          elements: [{ type: "panel", children: [{ type: "nosuch" }] }],
        },
      ],
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.pointer).toBe("/columns/0/elements/0/children/0");
  });
});

describe("行标签单一事实源（锚点: row-label-single-source）", () => {
  it("命令按 op 标签、元素按类型标签（回归锚定：元素层曾整层显示「（坏命令）」）", () => {
    expect(describeNodeLabel({ op: "say" })).toBe("对话");
    expect(describeNodeLabel({ type: "panel" })).toBe("面板");
    expect(describeNodeLabel({ type: "vbar" })).toBe("纵向进度条");
  });

  it("未知 op 回退原文，两者都不是才报坏节点（故意错误）", () => {
    expect(describeNodeLabel({ op: "no_such_op" })).toBe("no_such_op");
    expect(describeNodeLabel({})).toBe("（坏命令）");
    expect(describeNodeLabel({ type: 42 })).toBe("（坏命令）");
    expect(describeNodeLabel(undefined)).toBe("（坏命令）");
  });
});

describe("字段值落树（锚点: field-value-coercion）", () => {
  it("value kind 智能字面量：纯数字还原为数字（回归锚定：曾退化成无单位字符串）", () => {
    expect(coerceFieldValue("value", "120")).toBe(120);
    expect(coerceFieldValue("value", "-3.5")).toBe(-3.5);
    expect(coerceFieldValue("value", "true")).toBe(true);
    expect(coerceFieldValue("value", "false")).toBe(false);
    // CSS 长度与表达式保持字符串（不得被数字化）
    expect(coerceFieldValue("value", "50%")).toBe("50%");
    expect(coerceFieldValue("value", "calc(100% - 8px)")).toBe(
      "calc(100% - 8px)",
    );
    expect(coerceFieldValue("value", "{player.gold}")).toBe("{player.gold}");
  });

  it("其余 kind 的落树口径（互锁：与 number/boolean 语义一致）", () => {
    expect(coerceFieldValue("number", "42")).toBe(42);
    expect(coerceFieldValue("integer", "42")).toBe(42);
    expect(coerceFieldValue("boolean", "true")).toBe(true);
    expect(coerceFieldValue("boolean", "false")).toBe(false);
    expect(coerceFieldValue("string", "120")).toBe("120"); // 纯字符串 kind 不数字化
    expect(coerceFieldValue("identifier", "inn")).toBe("inn");
  });

  it("长度类字段一律 kind:value（回归锚定：数字 → px 由运行时 len() 补）", () => {
    for (const type of ["background", "text", "panel", "image"] as const) {
      const byKey = new Map(
        (describeElement(type)?.fields ?? []).map((f) => [f.key, f]),
      );
      for (const key of ["x", "y", "width", "height"]) {
        expect(byKey.get(key)?.kind, `${type}.${key}`).toBe("value");
      }
    }
    const text = new Map(
      (describeElement("text")?.fields ?? []).map((f) => [f.key, f]),
    );
    expect(text.get("size")?.kind).toBe("value");
    expect(text.get("color")?.kind).toBe("string"); // 颜色不是长度，保持字符串
  });

  it("FieldRow 渲染面覆盖全部 FieldKind（回归锚定：value 曾无控件，整行不可编辑）", () => {
    const kinds = new Set<string>();
    const collect = (fields: readonly FieldDescriptor[]): void => {
      for (const field of fields) {
        kinds.add(field.kind);
        const nested = field.item?.properties;
        if (nested !== undefined) collect(nested);
      }
    };
    for (const meta of listOps()) {
      collect(describeForm(meta.op)?.fields ?? []);
    }
    for (const type of ELEMENT_TYPES) {
      collect(describeElement(type)?.fields ?? []);
    }
    expect(kinds.size).toBeGreaterThan(0); // 防提取失效空跑
    expect(kinds.has("value")).toBe(true);
    // 每个实际出现的 kind 都必须在 FieldRow 的 kind 分支里被提到
    // （模板里单/双引号混用，故按「任意引号包裹的字面量」匹配）
    for (const kind of kinds) {
      expect(
        fieldRowSource,
        `FieldRow 未处理 kind: ${kind}`,
      ).toMatch(new RegExp(`['"]${kind}['"]`));
    }
  });
});
