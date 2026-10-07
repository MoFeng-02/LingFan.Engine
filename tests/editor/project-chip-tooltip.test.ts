/**
 * 顶栏「打开工程」chip tooltip（小项）**接线互锁**：
 * 「全路径」的唯一诚实来源是宿主 watch 端点回传的监视根 —— 浏览器 FSA 拿不到
 * 绝对路径（平台事实）。tooltip **两行各标身份**（工程资源根 / 宿主工作区根），
 * 不把宿主监视根冒充成所开工程的路径。
 */
import { describe, expect, it } from "vitest";
import appSource from "../../apps/editor/src/App.vue?raw";

/** 去注释后再匹配（守卫对象是代码，不是注释里的字样） */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("chip 全路径 tooltip · 接线互锁", () => {
  it("tooltip 走 computed（两行拼接在判据处，不在模板里内联）", () => {
    const src = code(appSource);
    expect(src).toContain(':title="projectChipTitle"');
    expect(src).toMatch(/const projectChipTitle = computed/);
    // 两行各自标注身份（不把宿主监视根冒充成工程路径）
    expect(src).toContain("工程资源根：${projectRoot.value}");
    expect(src).toContain("宿主工作区根：${hostRoot.value}");
  });

  it("hostRoot 来自 **watch 端点回传**（onMounted 契约时刻探测，非编造）", () => {
    const src = code(appSource);
    expect(src).toContain("fetchWatchStatus(host)");
    expect(src).toContain("hostRoot.value = status.root");
  });
});
