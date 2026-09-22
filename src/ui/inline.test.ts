/** 08 §四.3 内联标记渲染测试（UI 层职责：核心层透传 → UI 上屏） */
import { describe, expect, it } from "vitest";
import { renderInlineMarkup } from "./inline";

describe("renderInlineMarkup", () => {
  it("b/i/u 样式化与嵌套", () => {
    expect(renderInlineMarkup("{b}粗{/b}")).toBe("<b>粗</b>");
    expect(renderInlineMarkup("{b}{i}斜粗{/i}{/b}")).toBe("<b><i>斜粗</i></b>");
  });

  it("color/size/font 属性标记", () => {
    expect(renderInlineMarkup("{color=#FFD700}金{/color}")).toBe(
      '<span style="color:#FFD700">金</span>',
    );
    expect(renderInlineMarkup("{size=32}大{/size}")).toBe(
      '<span style="font-size:32px">大</span>',
    );
    expect(renderInlineMarkup("{font=楷体}字{/font}")).toBe(
      "<span style=\"font-family:'楷体'\">字</span>",
    );
  });

  it("裸 {color} 按闭合处理（老引擎语义）", () => {
    expect(renderInlineMarkup("{color=#fff}金{color}")).toBe(
      '<span style="color:#fff">金</span>',
    );
  });

  it("{p}/{w}/{fast} 渲染为空（段内停顿随打字机阶段接管）", () => {
    expect(renderInlineMarkup("甲{p}乙{w}丙{fast}丁")).toBe("甲乙丙丁");
  });

  it("未知 {…} 按字面保留（变量插值已在核心层完成）", () => {
    expect(renderInlineMarkup("金币 {player.gold} 枚")).toBe(
      "金币 {player.gold} 枚",
    );
  });

  it("未闭合标记容错补齐", () => {
    expect(renderInlineMarkup("{b}没闭合")).toBe("<b>没闭合</b>");
  });

  it("HTML 全量转义（防注入）", () => {
    expect(renderInlineMarkup('<b>危险</b> & "引号"')).toBe(
      "&lt;b&gt;危险&lt;/b&gt; &amp; &quot;引号&quot;",
    );
    expect(renderInlineMarkup("{color=#fff;position:fixed}x{/color}")).toBe(
      "x",
    ); // 非法 color 丢弃样式
    expect(renderInlineMarkup("{font=a';bad}x{/font}")).toBe("x"); // 非法 font 丢弃样式
  });

  it("无标记文本原样转义输出", () => {
    expect(renderInlineMarkup("纯文本。")).toBe("纯文本。");
  });
});
