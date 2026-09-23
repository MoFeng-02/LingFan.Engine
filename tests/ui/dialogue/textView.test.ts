/** 统一文字渲染接缝测试：typed 优先 / 转义 / 管线一致性。 */
import { describe, expect, it } from "vitest";
import { renderDialogueLine, renderInlineMarkup } from "@lingfan/ui";

describe("renderDialogueLine（统一文字渲染接缝）", () => {
  it("静态行：整段 text 走管线（等价 renderInlineMarkup）", () => {
    expect(renderDialogueLine({ text: "{b}粗{/b}" }).html).toBe(
      renderInlineMarkup("{b}粗{/b}"),
    );
    expect(renderDialogueLine({ text: "{b}粗{/b}" }).html).toContain(
      "<b>粗</b>",
    );
  });

  it("打字中：typed 前缀优先于整段 text（逐字渐进且带样式）", () => {
    const view = renderDialogueLine({
      text: "{color=#FFD700}金{color}",
      typed: "{color=#FFD700}金",
    });
    expect(view.html).toContain('style="color:#FFD700"');
    expect(view.html).not.toContain("{color}");
  });

  it("防注入不放松：文本内容全量转义", () => {
    const view = renderDialogueLine({ text: "<img src=x onerror=alert(1)>" });
    expect(view.html).not.toContain("<img");
    expect(view.html).toContain("&lt;img");
  });
});
