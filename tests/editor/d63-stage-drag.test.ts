/**
 * 舞台拖拽回归测试 —— 「一碰即跳回时间线、拖拽完全不可用」。
 *
 * 现象：
 * 「在舞台视图点或拖任一元素，pointerdown 瞬间就被当成点击，视图立刻切回时间线，
 *   元素再也拖不动——完全不区分你是不是拖拽」
 *
 * 覆盖要点：
 * - 严格多方位 / 边界条件 ⇒ `pointerIntent.test.ts`
 * - 回归 / 源级互锁 ⇒ 本文件
 * - 跨边界互锁 ⇒ `editorApi` 契约面（`select` 不得再切视图；`reveal` 必须在两处需求点）
 */
import { describe, expect, it } from "vitest";
import appSource from "../../apps/editor/src/App.vue?raw";
import stageEditorSource from "../../apps/editor/src/components/StageEditor.vue?raw";
import diagnosticsSource from "../../apps/editor/src/components/DiagnosticsPanel.vue?raw";
import stepLayoutSource from "../../apps/editor/src/components/StepLayout.vue?raw";
import timelineSource from "../../apps/editor/src/components/StoryTimeline.vue?raw";

/** 去注释（守卫对象是代码，注释里提到旧行为是正常的） */
const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("舞台拖拽回归 · select 不得再切视图", () => {
  it("`select()` 只做选中，**不含** `centerView` 赋值（修法 a）", () => {
    const src = code(appSource);
    // 取 select 的函数体（到下一个同缩进方法为止）
    const start = src.indexOf("select(pointer: string | null): void {");
    expect(start).toBeGreaterThan(-1);
    // 找它的结束：下一个 "\n  }," 之前的区间
    const end = src.indexOf("\n  },", start);
    const body = src.slice(start, end);
    expect(body).not.toContain("centerView");
    expect(body).not.toContain("scrollIntoView");
  });

  it("`reveal()` 独立存在且承担「切视图 + 滚动」", () => {
    const src = code(appSource);
    const start = src.indexOf("reveal(pointer: string): void {");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("\n  },", start));
    expect(body).toContain("centerView.value = \"timeline\"");
    expect(body).toContain("scrollIntoView");
  });

  it("`reveal` 先选中再切视图（顺序不能反，否则滚动时无选中行可锚）", () => {
    const src = code(appSource);
    const start = src.indexOf("reveal(pointer: string): void {");
    const body = src.slice(start, src.indexOf("\n  },", start));
    expect(body.indexOf("api.select(")).toBeLessThan(body.indexOf("centerView.value"));
    expect(body.indexOf("api.select(")).toBeGreaterThan(-1);
  });
});

describe("舞台拖拽回归 · 依赖切视图副作用的两处已显式化", () => {
  it("诊断面板走 `reveal`（点诊断必须看得见）", () => {
    expect(code(diagnosticsSource)).toContain("api.reveal(diagnostic.pointer)");
    expect(code(diagnosticsSource)).not.toMatch(/api\.select\(diagnostic\.pointer\)/);
    // 契约面必须声明 reveal
    expect(diagnosticsSource).toMatch(/interface EditorApi\s*\{[^}]*reveal\(/);
  });

  it("步骤图走 `reveal`（从步骤图定位回时间线）", () => {
    expect(code(stepLayoutSource)).toContain("api.reveal(step.endPointer)");
    expect(code(stepLayoutSource)).not.toMatch(/api\.select\(step\.endPointer\)/);
    expect(stepLayoutSource).toMatch(/interface EditorApi\s*\{[^}]*reveal\(/);
  });

  it("舞台走**就地选中**（这才是修法的关键：不再被卸载）", () => {
    expect(code(stageEditorSource)).toContain("api.select(target)");
    expect(code(stageEditorSource)).not.toContain("api.reveal(");
  });
});

describe("舞台拖拽回归 · 拖拽阈值接线", () => {
  it("舞台接了指针捕获（拖出元素范围仍跟手）", () => {
    expect(code(stageEditorSource)).toContain("setPointerCapture");
    expect(code(stageEditorSource)).toContain("hasPointerCapture");
    expect(code(stageEditorSource)).toContain("isConnected");
  });

  it("阈值判据来自纯函数，**不在组件里内联数字**", () => {
    const src = code(stageEditorSource);
    expect(src).toContain("interactionIntent");
    expect(src).toContain("shouldSuppressClick");
    // 阈值常量不得散落在组件（调样式时会被无意改掉）
    expect(src).not.toMatch(/>\s*4\s*px/);
    expect(src).not.toMatch(/>\s*5\s*px/);
  });

  it("阈值内不显示位移（点一下不该看到元素跟手抖动）", () => {
    const src = code(stageEditorSource);
    const onMove = src.slice(src.indexOf("const onMove"), src.indexOf("const onUp"));
    expect(onMove).toContain("shouldSuppressClick");
    // 早返回必须在赋值 drag.value 之前
    expect(onMove.indexOf("if (!shouldSuppressClick")).toBeLessThan(onMove.indexOf("drag.value ="));
  });

  it("时间线等「就地选中」路径不受影响（仍用 select）", () => {
    expect(code(timelineSource)).toContain("api.select(row.pointer)");
    expect(code(timelineSource)).not.toContain("api.reveal(");
  });
});
