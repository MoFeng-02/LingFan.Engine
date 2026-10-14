/**
 * 属性面板入右栏 + tab 无障碍语义**接线互锁**。
 *
 * 设计意图：中央属性面板与下方区域空间错配（面板矮、下方空）；
 * 移入右栏作**首 tab**（跟随选中项的主编辑面），中央时间线拿回全部高度。
 * 左栏 / 右栏的 tab 若是**裸 button**（读屏只知道「一排按钮」，
 * 不知道是互斥视图切换）——补 role=tablist/tab/aria-selected。
 *
 * 只移动不重设计：PropertyPanel 本体零改动（视觉重构不在本次范围）。
 *
 * 左栏 / 右栏模板在 SidebarPane / RightPane、中心区在 CenterStage，
 * 断言随之重新指向（找的内容不变，换找的位置）。
 */
import { describe, expect, it } from "vitest";
import appSource from "../../apps/editor/src/App.vue?raw";
import leftTabsSource from "../../apps/editor/src/app/leftTabs.ts?raw";
import centerSource from "../../apps/editor/src/components/CenterStage.vue?raw";
import rightPaneSource from "../../apps/editor/src/components/RightPane.vue?raw";
import sidebarSource from "../../apps/editor/src/components/SidebarPane.vue?raw";
import propertyPanelSource from "../../apps/editor/src/components/PropertyPanel.vue?raw";

/** 去注释后再匹配（守卫对象是代码，不是注释里的字样） */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const rightPane = code(rightPaneSource);
const centerTimeline = code(centerSource).slice(
  code(centerSource).indexOf("centerView === 'timeline'"),
  code(centerSource).indexOf("centerView === 'stage'"),
);

describe("属性面板入右栏 · 接线互锁", () => {
  it("PropertyPanel **只渲染在右栏**（v-show=property），中央时间线不再有它", () => {
    expect(rightPane.match(/<PropertyPanel/g)?.length).toBe(1); // 恰好一处（搬家不是复制）
    expect(rightPane).toMatch(/v-show="props\.rightTab === 'property'"/);
    expect(rightPane).toContain("<PropertyPanel");
    // 反面：中央时间线切片里不得再出现属性面板
    expect(centerTimeline).not.toContain("PropertyPanel");
    expect(code(appSource)).not.toContain("<PropertyPanel");
  });

  it("属性是**首 tab 且默认页**（跟随选中项的主编辑面，不该藏在第二位）", () => {
    const src = code(appSource);
    // 复杂判定用字符串 includes（正则里的 <> 引号会被工具链切坏）；
    // 双侧去空白后再比（prettier 可能把泛型折成多行，语义不变）
    // 互斥视图联合类型在 RightPane（export type RightTab），组合根持默认值
    expect(src.replace(/\s+/g, "")).toContain('ref<RightTab>("property")');
    expect(rightPane.replace(/\s+/g, "")).toContain(
      'exporttypeRightTab=|"property"|"diagnostics"|"json"|"text"|"i18n"|"pack"',
    );
    // 右栏 tab strip 里「属性」在「诊断」之前
    const strip = rightPane.slice(
      rightPane.indexOf("右栏面板"),
      rightPane.indexOf("</div>"),
    );
    expect(strip.indexOf("属性")).toBeGreaterThan(-1);
    expect(strip.indexOf("属性")).toBeLessThan(strip.indexOf("诊断"));
  });

  it("右栏 / 左栏 tab strip 都有 **tablist + aria-label + aria-selected**（裸 button = 读屏失义）", () => {
    const sidebar = code(sidebarSource);
    expect(rightPane).toContain('role="tablist" aria-label="右栏面板"');
    expect(sidebar).toContain('role="tablist" aria-label="侧栏视图"');
    // 左栏 6 个 + 右栏 5 个 tab 都有选中态；顶栏视图切换另有若干，不逐一枚举。
    // 左栏以 v-for 渲染（字面量各 1 处），运行时数量 = LEFT_TABS 长度：
    // 模板断言 v-for/role/aria-selected 就位，再以 LEFT_TABS 实际条目数 + 右栏
    // 字面量数合计验收（语义与原「逐字面量计数 ≥11」等价）。
    expect(sidebar).toContain('v-for="tab in LEFT_TABS"');
    expect(sidebar).toContain('role="tab"');
    expect(sidebar).toContain(":aria-selected=");
    const leftCount = leftTabsSource.match(/id: "/g)?.length ?? 0; // LEFT_TABS 条目数（6）
    const rightSelected = rightPane.match(/aria-selected=/g)?.length ?? 0;
    const rightTabs = rightPane.match(/role="tab"/g)?.length ?? 0;
    expect(leftCount + rightSelected).toBeGreaterThanOrEqual(11);
    expect(leftCount + rightTabs).toBeGreaterThanOrEqual(11);
  });

  it("PropertyPanel 本体**零改动**（props 仍是 story+pointer —— 只移动不重设计）", () => {
    expect(code(propertyPanelSource)).toContain(
      "defineProps<{ story: Story; pointer: string | null }>",
    );
  });
});
