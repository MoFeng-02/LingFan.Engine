/**
 * 属性面板入右栏 + tab 无障碍语义（#8）**接线互锁**。
 *
 * 设计意图：中央属性面板实测 188px 高、下方 483px 空（空间错配）；
 * 移入右栏作**首 tab**（跟随选中项的主编辑面），中央时间线拿回全部高度。
 * 左栏 / 右栏的 tab 若是**裸 button**（读屏只知道「一排按钮」，
 * 不知道是互斥视图切换）——补 role=tablist/tab/aria-selected。
 *
 * 只移动不重设计：PropertyPanel 本体零改动（视觉重构等用户验收后）。
 */
import { describe, expect, it } from "vitest";
import appSource from "../../apps/editor/src/App.vue?raw";
import propertyPanelSource from "../../apps/editor/src/components/PropertyPanel.vue?raw";

/** 去注释后再匹配（守卫对象是代码，不是注释里的字样） */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const rightPane = code(appSource).slice(code(appSource).indexOf('class="pane right-pane"'));
const centerTimeline = code(appSource).slice(
  code(appSource).indexOf("centerView === 'timeline'"),
  code(appSource).indexOf("centerView === 'stage'"),
);

describe("属性面板入右栏 · 接线互锁", () => {
  it("PropertyPanel **只渲染在右栏**（v-show=property），中央时间线不再有它", () => {
    const src = code(appSource);
    expect(src.match(/<PropertyPanel/g)?.length).toBe(1); // 恰好一处（搬家不是复制）
    expect(rightPane).toMatch(/v-show="rightTab === 'property'"/);
    expect(rightPane).toContain("<PropertyPanel");
    // 反面：中央时间线切片里不得再出现属性面板
    expect(centerTimeline).not.toContain("PropertyPanel");
  });

  it("属性是**首 tab 且默认页**（跟随选中项的主编辑面，不该藏在第二位）", () => {
    const src = code(appSource);
    // 复杂判定用字符串 includes（正则里的 <> 引号会被工具链切坏）
    expect(src).toContain(
      'ref<"property" | "diagnostics" | "json" | "text" | "i18n" | "pack">("property")',
    );
    // 右栏 tab strip 里「属性」在「诊断」之前
    const strip = rightPane.slice(rightPane.indexOf("右栏面板"), rightPane.indexOf("</div>"));
    expect(strip.indexOf("属性")).toBeGreaterThan(-1);
    expect(strip.indexOf("属性")).toBeLessThan(strip.indexOf("诊断"));
  });

  it("右栏 / 左栏 tab strip 都有 **tablist + aria-label + aria-selected**（裸 button = 读屏失义）", () => {
    const src = code(appSource);
    expect(src).toContain('role="tablist" aria-label="右栏面板"');
    expect(src).toContain('role="tablist" aria-label="侧栏视图"');
    // 左栏 6 个 + 右栏 5 个 tab 都有选中态（11 处起——顶栏视图切换另有若干）
    expect(src.match(/aria-selected=/g)?.length).toBeGreaterThanOrEqual(11);
    expect(src.match(/role="tab"/g)?.length).toBeGreaterThanOrEqual(11);
  });

  it("PropertyPanel 本体**零改动**（props 仍是 story+pointer —— 只移动不重设计）", () => {
    expect(code(propertyPanelSource)).toContain('defineProps<{ story: Story; pointer: string | null }>');
  });
});
