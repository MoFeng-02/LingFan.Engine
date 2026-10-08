/**
 * 白屏归因判据：`classifyWhiteScreen` 是纯函数，
 * 决定 iOS CI 回传日志里那条 `verdict` 落在哪一类——判错会把根因带偏。
 *
 * 三类（外加 not-diagnosable 的 unknown）：
 *   01-dom-missing / 01-page-hidden / 01-viewport-zero / 02-style-missing / 03-content-invisible
 * 排序是**有意**的：`01-page-hidden` 必须排在尺寸判据之前——隐藏页的尺寸读数会失真。
 */
import { describe, expect, it } from "vitest";
import {
  classifyWhiteScreen,
  type WhiteScreenEvidence,
} from "../../apps/playground/src/diag";

/** 正常渲染页（各判据全过）——作为基准，逐例只改要考的那一项 */
function evidence(overrides: Partial<WhiteScreenEvidence> = {}): WhiteScreenEvidence {
  return {
    bodyHtmlLen: 4096,
    appChildren: 1,
    win: [720, 1280],
    visual: [720, 1280],
    appRect: [720, 1280],
    styleSheets: 1,
    styleSheetsLoaded: 1,
    visibilityState: "visible",
    ...overrides,
  };
}

describe("classifyWhiteScreen", () => {
  it("基准：证据全正常 ⇒ 落在「内容不可见」而非 unknown", () => {
    const v = classifyWhiteScreen(evidence());
    expect(v.cls).toBe("03-content-invisible");
  });

  it("DOM 未建立：body 极短且 #app 空", () => {
    expect(classifyWhiteScreen(evidence({ bodyHtmlLen: 0, appChildren: 0 })).cls).toBe(
      "01-dom-missing",
    );
    expect(classifyWhiteScreen(evidence({ bodyHtmlLen: 0, appChildren: -1 })).cls).toBe(
      "01-dom-missing",
    );
  });

  it("页面 hidden 优先于尺寸判据（尺寸读数在隐藏页失真，先排除）", () => {
    const v = classifyWhiteScreen(
      evidence({ visibilityState: "hidden", win: [0, 0], appRect: [0, 0] }),
    );
    expect(v.cls).toBe("01-page-hidden");
    expect(v.why).toContain("非缺陷");
  });

  it("视口/渲染面尺寸为 0：window / visualViewport / #app 任一路为 0 即命中", () => {
    expect(classifyWhiteScreen(evidence({ win: [0, 1280] })).cls).toBe("01-viewport-zero");
    expect(classifyWhiteScreen(evidence({ visual: [720, 0] })).cls).toBe("01-viewport-zero");
    expect(classifyWhiteScreen(evidence({ appRect: [0, 0] })).cls).toBe("01-viewport-zero");
  });

  it("样式表未生效：表数为 0，或 <link> 一张都没真加载", () => {
    expect(
      classifyWhiteScreen(evidence({ styleSheets: 0, styleSheetsLoaded: 0 })).cls,
    ).toBe("02-style-missing");
    // 有 <link> 但 sheet 全 null（自定义 scheme 子资源被拒的典型形态）
    expect(
      classifyWhiteScreen(evidence({ styleSheets: 1, styleSheetsLoaded: 0 })).cls,
    ).toBe("02-style-missing");
    // styleSheets 数为 0 但 loaded 计数为 0 亦命中（两者是同一类的两种读数）
    expect(classifyWhiteScreen(evidence({ styleSheets: 2, styleSheetsLoaded: 2 })).cls).toBe(
      "03-content-invisible",
    );
  });

  it("unknown：DOM 有规模但没有 #app（判据覆盖不到，不硬套结论）", () => {
    expect(classifyWhiteScreen(evidence({ appChildren: -1 })).cls).toBe("unknown");
    expect(classifyWhiteScreen(evidence({ appChildren: 0 })).cls).toBe("unknown");
  });

  it("why 文案带出关键读数（CI 只看到一行日志也能定位）", () => {
    const v = classifyWhiteScreen(evidence({ styleSheets: 3, styleSheetsLoaded: 0 }));
    expect(v.why).toContain("styleSheets=3");
    expect(v.why).toContain("已加载=0");
  });
});
