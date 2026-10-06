/**
 * 诊断分级徽章（#9）**接线互锁**：判据（filterDiagnosticsBySeverity）有了，
 * 组件没接上就是白做（chapter-tree-wiring 同款教训）。
 *
 * 额外锁一条**语义不变量**：徽章计数是「普查」（吃全量），分组渲染是「筛选后」
 * ——两者若吃同一份，筛选时计数会缩水 ⇒ 徽章数字跳变 = 仪表盘失真。
 */
import { describe, expect, it } from "vitest";
import panelSource from "../../apps/editor/src/components/DiagnosticsPanel.vue?raw";

/** 去注释后再匹配（守卫对象是代码，不是注释里的字样） */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("诊断徽章 · 接线互锁", () => {
  it("🔴 组件 **import 并使用** filterDiagnosticsBySeverity（筛选语义单一事实源）", () => {
    const src = code(panelSource);
    expect(src).toContain("filterDiagnosticsBySeverity(");
    // 反面：组件不得自己手写 severity 过滤（第二真源）
    expect(src).not.toMatch(/\.filter\(\(?[^)]*\)?\s*=>\s*[^)]*severity\s*===/);
  });

  it("🔴 徽章是**可点按钮**且带 aria-pressed（激活态对读屏可见）", () => {
    const src = code(panelSource);
    expect(src.match(/class="diag-x-badge /g)?.length).toBe(2); // 两枚徽章都是静态基类 + 动态激活类
    expect(src.match(/aria-pressed=/g)?.length).toBe(2); // 两枚徽章都要有
    expect(src).toContain("toggleFilter(");
  });

  it("🔴 零档**禁用**（没有可筛的东西不给假按钮）", () => {
    const src = code(panelSource);
    expect(src).toContain(':disabled="summary.errors === 0"');
    expect(src).toContain(':disabled="summary.warnings === 0"');
  });

  it("🔴 **普查与筛选分离**：summary 吃全量 diagnostics，groups 吃筛选子集", () => {
    const src = code(panelSource);
    // summary 的实参是**原始 props.diagnostics**（未经 filter）
    expect(src).toMatch(/summarizeDiagnostics\(groupDiagnostics\(props\.diagnostics\)\)/);
    // groups 的实参经过 filterDiagnosticsBySeverity
    expect(src).toMatch(
      /groupDiagnostics\(filterDiagnosticsBySeverity\(props\.diagnostics,\s*severityFilter\.value\)\)/,
    );
  });
});
