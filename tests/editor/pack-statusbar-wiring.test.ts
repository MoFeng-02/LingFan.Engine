/**
 * 打包入口置于状态栏**接线互锁**。
 *
 * 设计意图：打包是低频动作（分钟计），不占右栏一级 tab；入口放到状态栏
 * （**带文字标签**——纯图标按钮对读屏等于不存在），
 * 长任务的「打包中…」状态常驻状态栏（面板切走也不丢进度感知）。
 *
 * 锁四条线：tab 已移除 · 状态栏按钮带语义 · App 双向接线 · 面板本体保留。
 */
import { describe, expect, it } from "vitest";
import appSource from "../../apps/editor/src/App.vue?raw";
import statusBarSource from "../../apps/editor/src/components/StatusBar.vue?raw";
import packPanelSource from "../../apps/editor/src/components/PackPanel.vue?raw";

/** 去注释后再匹配（守卫对象是代码，不是注释里的字样） */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("打包入口置于状态栏 · 接线互锁", () => {
  it("右栏 tab strip **不再有**「打包」按钮（避免双入口并存）", () => {
    const src = code(appSource);
    // 反面：tab 点击式入口必须消失（否则「同一功能两个入口」）
    expect(src).not.toContain('@click="rightTab = \'pack\'"');
  });

  it("状态栏按钮**带文字标签 + aria-pressed**（icon-only = 对读屏不存在）", () => {
    const src = code(statusBarSource);
    expect(src).toContain('class="pack-entry"');
    expect(src).toContain(':aria-pressed="packActive"');
    expect(src).toContain("(e: \"toggle-pack\")");
    // 长任务存在感：打包中标签随 packing 变化
    expect(src).toContain('packing ? "打包中…" : "打包"');
  });

  it("App 与状态栏**双向接线**（按钮点了必须有人接）", () => {
    const src = code(appSource);
    expect(src).toContain(':packing="packing"');
    expect(src).toContain(':pack-active="rightTab === \'pack\'"');
    expect(src).toContain('@toggle-pack="togglePackPane"');
    // toggle 语义：已在打包页 ⇒ 回诊断（不是单向开关）
    expect(src).toContain('rightTab.value === "pack" ? "diagnostics" : "pack"');
  });

  it("打包中记账在 **send 包装处**（面板切走状态栏仍可见）", () => {
    const src = code(appSource);
    expect(src).toContain("packing.value = true");
    expect(src).toMatch(/finally\s*{\s*packing\.value = false/);
  });

  it("PackPanel **本体保留**（打包页内容不因入口迁移而丢失）", () => {
    const src = code(appSource);
    expect(src).toMatch(/v-show="rightTab === 'pack'"/);
    expect(code(packPanelSource)).toContain("开始打包");
  });
});
