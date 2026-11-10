/**
 * 元素 `stretch`（媒体填充方式）的编辑期诊断：取值不在中立词表内 ⇒ `warning`。
 *
 * 为什么需要这条诊断：三端渲染对非法 `stretch` 都是**静默回退**缺省填充方式
 * （`DEFAULT_ELEMENT_FIT`），用户在编辑器里看不到任何提示，只能到运行期
 * 发现「图片摆放不对」。词表与缺省值都取自引擎契约，本测试同时钉住
 * 「词表只有一处事实」这件事。
 *
 * 非字符串取值（数字等）不归本条：那是类型错误，由 `invalid-element` 负责。
 */
import { describe, expect, it } from "vitest";
import type { ElementNode, Story } from "@lingfan-engine/core";
import { DEFAULT_ELEMENT_FIT, ELEMENT_FITS } from "@lingfan-engine/core";
import { analyzeStory, getAtPointer } from "@lingfan-engine/editor";

function sceneStory(elements: ElementNode[]): Story {
  return {
    formatVersion: 1,
    id: "demo",
    entry: "stage",
    columns: [
      {
        id: "stage",
        kind: "scene",
        elements,
        entry: [{ op: "say", text: "x" }],
      },
    ],
  };
}

/** 只取本条诊断（别的诊断族与本案无关，混进来会掩盖真正的回归） */
function fitDiagnostics(story: Story) {
  return analyzeStory(story).filter((d) => d.code === "invalid-element-fit");
}

describe("元素 stretch · 填充方式取值诊断", () => {
  it("词表内每个合法取值都零诊断", () => {
    for (const fit of ELEMENT_FITS) {
      const story = sceneStory([{ type: "image", src: "a.png", stretch: fit }]);
      expect(fitDiagnostics(story), `合法取值 ${fit} 不该报`).toEqual([]);
    }
  });

  it("非法取值 ⇒ 一条 warning，指针精确到 /stretch", () => {
    const story = sceneStory([
      { type: "image", src: "a.png", stretch: "stretch" },
    ]);
    const diagnostics = fitDiagnostics(story);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe("warning");
    expect(diagnostics[0]?.pointer).toBe("/columns/0/elements/0/stretch");
    // 指针自身可解析（诊断面板点击定位依赖），并确实指向那个非法值
    expect(getAtPointer(story, diagnostics[0]!.pointer)).toBe("stretch");
  });

  it("文案列出全部合法取值与缺省回退值（都从契约词表拼，不手写）", () => {
    const story = sceneStory([
      { type: "image", src: "a.png", stretch: "stretch" },
    ]);
    const message = fitDiagnostics(story)[0]!.message;
    expect(message).toContain("stretch");
    for (const fit of ELEMENT_FITS) {
      expect(message, `文案漏了合法取值 ${fit}`).toContain(fit);
    }
    expect(message).toContain(DEFAULT_ELEMENT_FIT);
  });

  it("多个元素各自报一条（不合并、不遗漏）", () => {
    const story = sceneStory([
      { type: "image", src: "a.png", stretch: "bogus" },
      { type: "image", src: "b.png", stretch: "cover" },
      { type: "panel", stretch: "also-bogus" },
    ]);
    const pointers = fitDiagnostics(story)
      .map((d) => d.pointer)
      .sort();
    expect(pointers).toEqual([
      "/columns/0/elements/0/stretch",
      "/columns/0/elements/2/stretch",
    ]);
  });

  it("未声明 stretch ⇒ 零诊断（缺省 cover 是正常形态，不是错误）", () => {
    const story = sceneStory([{ type: "image", src: "a.png" }]);
    expect(fitDiagnostics(story)).toEqual([]);
  });

  it("stretch 非字符串 ⇒ 零本条诊断（类型错误交给 invalid-element）", () => {
    const story = sceneStory([
      // 历史工程里的脏数据形态：数字被当成填充方式写进去
      { type: "image", src: "a.png", stretch: 1 as unknown as never },
    ]);
    expect(fitDiagnostics(story)).toEqual([]);
  });
});
