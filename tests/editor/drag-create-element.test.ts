/**
 * 控件从面板拖入画布生成元素测试。
 *
 * 测试纪律：
 * - 纯逻辑边界：草稿最小面（无失真属性）/ 未知类型与坏坐标 fail-closed / 命中容器的相对坐标
 * - 拟态作者旅程：拖入 → 一个 undo 单元 → 一步回到原状；嵌套容器 → 进 children（相对坐标）
 * - 互锁：诊断零新增（拖入不制造 invalid-element / unimplemented-element-attr）
 * - 源码互锁：提交走 session（单 commit）、fail-closed 分支在组件里真实存在
 */

import { describe, expect, it } from "vitest";
import type { Story, StoryColumn } from "@lingfan/engine";
import {
  analyzeStory,
  createElementDraft,
  EditorSession,
  getAtPointer,
  insertAtPointer,
  planElementDrop,
  setAtPointer,
  UNIMPLEMENTED_ELEMENT_ATTRS,
} from "@lingfan/editor";
import appSource from "../../apps/editor/src/App.vue?raw";
import stageEditorSource from "../../apps/editor/src/components/StageEditor.vue?raw";

function sceneColumn(id: string, elements: unknown[]): StoryColumn {
  return { id, kind: "scene", elements } as StoryColumn;
}

function makeStory(elements: unknown[]): Story {
  return {
    formatVersion: 1,
    id: "demo",
    entry: "start",
    columns: [
      { id: "start", kind: "flow", commands: [{ op: "say", text: "开场" }] },
      sceneColumn("stage", elements),
    ],
  };
}

/** 与 App.vue `insertElement` 相同的提交体（纯函数组合；一次调用 = 一个 undo 单元） */
function insertElementViaApi(
  session: EditorSession,
  columnPointer: string,
  element: Record<string, unknown>,
  parentPointer?: string,
): void {
  session.apply(`拖入元素 ${String(element.type ?? "")}`, (s) => {
    const target =
      parentPointer === undefined
        ? `${columnPointer}/elements`
        : `${parentPointer}/children`;
    const list = getAtPointer(s, target);
    const index = Array.isArray(list) ? list.length : 0;
    const base = Array.isArray(list) ? s : setAtPointer(s, target, []);
    return insertAtPointer(base, target, index, element);
  });
}

describe("createElementDraft：最小草稿面", () => {
  it("已知类型 → {type,x,y} 数字且取整；未知类型 / 非有限坐标 → null（fail-closed）", () => {
    expect(createElementDraft("panel", 120.4, 80.6)).toEqual({
      type: "panel",
      x: 120,
      y: 81,
    });
    expect(createElementDraft("richtext", 0, 0)).toBeNull(); // 不存在的类型名
    expect(createElementDraft("say", 0, 0)).toBeNull(); // op 名不是元素类型
    expect(createElementDraft("panel", Number.NaN, 0)).toBeNull();
    expect(createElementDraft("panel", 0, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("草稿绝不含失真属性（止血清单）：键面 ⊆ {type,x,y}", () => {
    for (const type of ["text", "panel", "image", "button", "bar"]) {
      const draft = createElementDraft(type, 10, 20);
      expect(draft).not.toBeNull();
      expect(Object.keys(draft ?? {}).sort()).toEqual(["type", "x", "y"]);
      for (const key of Object.keys(draft ?? {})) {
        expect(UNIMPLEMENTED_ELEMENT_ATTRS.has(key), key).toBe(false);
      }
    }
  });
});

describe("planElementDrop：落点规划", () => {
  it("未命中容器 → 顶级，坐标 = 画布内容坐标取整", () => {
    expect(planElementDrop(150.6, 90.2, undefined)).toEqual({
      parentIndex: null,
      x: 151,
      y: 90,
    });
  });

  it("命中容器 → 进 children，坐标换算为相对容器原点（负值不裁剪——由作者用面板修正）", () => {
    expect(
      planElementDrop(170, 95, { index: 2, originX: 40, originY: 140 }),
    ).toEqual({ parentIndex: 2, x: 130, y: -45 });
  });
});

describe("拟态作者旅程：拖入 → 一步回到原状（诊断零新增）", () => {
  it("顶级拖入：一个 undo 单元；undo 一步回原状；诊断计数前后一致", () => {
    const story = makeStory([]);
    const before = analyzeStory(story);
    const session = new EditorSession(story);

    const draft = createElementDraft("panel", 150, 120);
    expect(draft).not.toBeNull();
    insertElementViaApi(session, "/columns/1", draft ?? {});

    expect(session.undoDepth).toBe(1); // 一次拖入 = 一个 undo 单元
    expect(session.dirty).toBe(true);
    const elements = getAtPointer(session.story, "/columns/1/elements");
    expect(elements).toEqual([{ type: "panel", x: 150, y: 120 }]);
    expect(analyzeStory(session.story).length).toBe(before.length); // 诊断零新增

    expect(session.undo()).toBe(true); // 可撤销一步回到原状
    expect(getAtPointer(session.story, "/columns/1/elements")).toEqual([]);
    expect(session.story).toBe(story); // 恢复原引用
  });

  it("嵌套容器：进 children（相对坐标）；缺 children 数组时同一次提交内补齐；undo 仍是一步", () => {
    const story = makeStory([{ type: "panel", x: 40, y: 140, width: 320 }]);
    const session = new EditorSession(story);

    // 先补 children 数组能力的容器已存在但无 children —— 拖入文本落点在其内
    const plan = planElementDrop(170, 95, { index: 0, originX: 40, originY: 140 });
    expect(plan).toEqual({ parentIndex: 0, x: 130, y: -45 });
    const draft = createElementDraft("text", plan.x, plan.y);
    expect(draft).not.toBeNull();
    insertElementViaApi(session, "/columns/1", draft ?? {}, "/columns/1/elements/0");

    expect(session.undoDepth).toBe(1); // 补数组 + 插入 = 同一次提交
    const children = getAtPointer(session.story, "/columns/1/elements/0/children");
    expect(children).toEqual([{ type: "text", x: 130, y: -45 }]);
    // 顶级元素面不变（没把子元素误插到顶层）
    expect(getAtPointer(session.story, "/columns/1/elements")).toHaveLength(1);

    expect(session.undo()).toBe(true);
    expect(getAtPointer(session.story, "/columns/1/elements/0")).toEqual({
      type: "panel",
      x: 40,
      y: 140,
      width: 320,
    }); // children 数组一并消失（同一 undo 单元）
  });

  it("对已有 children 的容器追加：不影响既有子元素", () => {
    const story = makeStory([
      {
        type: "panel",
        x: 40,
        y: 140,
        children: [{ type: "text", text: "既有子元素" }],
      },
    ]);
    const session = new EditorSession(story);
    const draft = createElementDraft("button", 10, 20);
    expect(draft).not.toBeNull();
    insertElementViaApi(session, "/columns/1", draft ?? {}, "/columns/1/elements/0");
    const children = getAtPointer(session.story, "/columns/1/elements/0/children");
    expect(children).toEqual([
      { type: "text", text: "既有子元素" },
      { type: "button", x: 10, y: 20 },
    ]);
  });
});

describe("源码互锁：fail-closed 分支与单提交真实在位", () => {
  it("舞台只接面板 MIME 且只接元素类；判定与数值走纯函数", () => {
    expect(stageEditorSource).toContain(
      'const PALETTE_TYPE = "application/x-lingfan-palette"',
    );
    expect(stageEditorSource).toContain('kind !== "element"');
    expect(stageEditorSource).toContain("createElementDraft");
    expect(stageEditorSource).toContain("planElementDrop");
    expect(stageEditorSource).toContain("ELEMENT_CONTAINER_TYPES");
    // 不绕过会话（提交在 App.vue 的 session）
    expect(stageEditorSource).not.toMatch(/\bsession\b/);
    expect(stageEditorSource).not.toContain("insertAtPointer");
    // 画布空态提示引导作者用面板拖入
    expect(stageEditorSource).toContain("从左侧「组件」面板拖入");
  });

  it("宿主 insertElement 走 session.apply（一次拖入 = 一个 undo 单元），标签带元素类型", () => {
    expect(appSource).toContain("insertElement(");
    expect(appSource).toMatch(/session\.apply\(`拖入元素 \$\{elementLabel\(type\)\}`/);
  });
});