/**
 * 元素 `ops`（点击动作序列）的**编辑器面**测试：
 * - 表单描述符：`ops` 以 `body` 形态下发（复用命令体控件），`disabled` 接受表达式
 * - 编辑期诊断：序列里的执行期必拒 op ⇒ `error`（别等运行时才发现点不动）
 *
 * 与引擎侧的分工：本文件只看「编辑器能不能正确表达与预警」，
 * 执行语义（原子回滚 / 不建检查点 / 等待期限定）由 `tests/engine/runtime/element-ops-run.test.ts` 覆盖。
 */
import { describe, expect, it } from "vitest";
import type { ElementNode, Story } from "@lingfan/engine";
import { ELEMENT_OPS_BLOCKED } from "@lingfan/engine";
import { analyzeStory, describeElement, getAtPointer } from "@lingfan/editor";

function sceneStory(elements: ElementNode[]): Story {
  return {
    formatVersion: 1,
    id: "demo",
    entry: "stage",
    columns: [{ id: "stage", kind: "scene", elements, entry: [{ op: "say", text: "x" }] }],
  };
}

describe("元素表单 · ops 字段", () => {
  it("ops 以 body 形态下发（复用命令体控件：插入/删除/上下移/逐字段编辑）", () => {
    const descriptor = describeElement("button");
    const ops = descriptor?.fields.find((f) => f.key === "ops");
    expect(ops, "button 必须有 ops 字段").toBeDefined();
    expect(ops?.kind).toBe("body");
    expect(ops?.label).toContain("动作");
  });

  it("ops 紧随 nav/cmd（交互字段聚在一起，表单序不割裂）", () => {
    const keys = describeElement("button")!.fields.map((f) => f.key);
    const nav = keys.indexOf("nav");
    const ops = keys.indexOf("ops");
    const cmd = keys.indexOf("cmd");
    expect(nav).toBeGreaterThanOrEqual(0);
    expect(ops).toBe(nav + 1);
    expect(cmd).toBe(ops + 1);
  });

  it("disabled 用 value 形态（布尔或表达式两种都能填）", () => {
    const disabled = describeElement("button")?.fields.find(
      (f) => f.key === "disabled",
    );
    expect(disabled?.kind).toBe("value");
    expect(disabled?.label).toContain("表达式");
  });

  it("三个 disabled_* 视觉态字段下发（对 Ren'Py insensitive_*）", () => {
    const keys = describeElement("imagebutton")!.fields.map((f) => f.key);
    for (const key of ["disabled_source", "disabled_color", "disabled_opacity"]) {
      expect(keys, `${key} 应在表单里`).toContain(key);
    }
  });

  it("36 类型都带 ops 字段（任意元素都可挂点击动作）", () => {
    for (const type of ["text", "image", "panel", "bar", "spacer"]) {
      const keys = describeElement(type)!.fields.map((f) => f.key);
      expect(keys, `${type} 缺 ops`).toContain("ops");
    }
  });
});

describe("编辑期诊断 · 序列里的必拒 op", () => {
  it("命中 ELEMENT_OPS_BLOCKED 的 op ⇒ error，指针精确到该条目", () => {
    const story = sceneStory([
      {
        type: "button",
        text: "点我",
        ops: [{ op: "set", key: "a", value: 1 }, { op: "jump", target: "x" }],
      },
    ]);
    const diagnostics = analyzeStory(story).filter(
      (d) => d.code === "element-ops-blocked-op",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.pointer).toBe("/columns/0/elements/0/ops/1");
    expect(diagnostics[0]?.message).toContain("jump");
    // 指针自身可解析（诊断面板点击定位依赖）
    expect(getAtPointer(story, diagnostics[0]!.pointer)).toEqual({
      op: "jump",
      target: "x",
    });
  });

  it("每个被禁 op 都报（清单与执行期同源，不遗漏）", () => {
    const ops = [...ELEMENT_OPS_BLOCKED].map((op) => ({ op }));
    const story = sceneStory([{ type: "button", text: "x", ops }]);
    const diagnostics = analyzeStory(story).filter(
      (d) => d.code === "element-ops-blocked-op",
    );
    expect(diagnostics).toHaveLength(ELEMENT_OPS_BLOCKED.size);
    // 指针覆盖每一个下标（精确到条目）
    const pointers = diagnostics.map((d) => d.pointer).sort();
    const expected = ops
      .map((_, i) => `/columns/0/elements/0/ops/${i}`)
      .sort();
    expect(pointers).toEqual(expected);
  });

  it("合法动作序列（notify / set / style / 内建表现类）零诊断", () => {
    const story = sceneStory([
      {
        type: "button",
        text: "钱袋",
        ops: [
          { op: "set", key: "gold", value: "+= {10}" },
          { op: "notify", text: "到手" },
          { op: "style", target: "t", props: { opacity: 0.5 } },
        ],
      },
    ]);
    const codes = analyzeStory(story).map((d) => d.code);
    expect(codes).not.toContain("element-ops-blocked-op");
  });

  it("畸形条目（非对象 / 缺 op）不误报为 blocked（形态问题归 invalid-element）", () => {
    const story = sceneStory([
      { type: "button", text: "x", ops: [1, { key: "a" }] },
    ]);
    const codes = analyzeStory(story).map((d) => d.code);
    expect(codes).not.toContain("element-ops-blocked-op");
  });

  it("嵌套容器的子元素同样检查（递归覆盖）", () => {
    const story = sceneStory([
      {
        type: "panel",
        id: "box",
        children: [
          { type: "button", text: "内层", ops: [{ op: "menu", prompt: "p" }] },
        ],
      },
    ]);
    const diagnostics = analyzeStory(story).filter(
      (d) => d.code === "element-ops-blocked-op",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.pointer).toBe(
      "/columns/0/elements/0/children/0/ops/0",
    );
  });
});
