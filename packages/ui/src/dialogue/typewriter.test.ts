/**
 * 08-U3 打字机二段式测试：tick 推进、{p}/{w} 段内停顿、点击三态、
 * **样式标记零宽 + 前缀永不半截**（用户实测回归：打字中裸 `{color=#` 上屏）。
 * 渲染协同：任意前缀经 renderInlineMarkup 不得残留裸 `{`。
 */
import { describe, expect, it } from "vitest";
import { renderInlineMarkup } from "./inline";
import { Typewriter, tokenizeStream } from "./typewriter";

describe("tokenizeStream（标记分词）", () => {
  it("剥离 {p}/{w} 并记录可见坐标，{fast} 直接删除", () => {
    const r = tokenizeStream("甲{p}乙{w}丙{fast}丁");
    expect(r.stream).toBe("甲乙丙丁");
    expect(r.pausePoints).toEqual([1, 2]);
    expect(r.visibleTotal).toBe(4);
  });

  it("样式标记保留在流内且**零宽**（不消耗打字时长）", () => {
    const r = tokenizeStream("{b}粗{/b}");
    expect(r.stream).toBe("{b}粗{/b}");
    expect(r.visibleTotal).toBe(1); // 标记不计入可见字符
  });

  it("未闭合标记容错：尾部残缺按字面保留（不计可见数——完成态随整条流上屏）", () => {
    const r = tokenizeStream("甲{color=#");
    expect(r.stream).toBe("甲{color=#");
    expect(r.visibleTotal).toBe(1);
  });
});

describe("Typewriter 二段式点击", () => {
  it("tick 按速度推进，到达 {p} 停住等点击", () => {
    const tw = new Typewriter("你{p}好", 10);
    tw.tick(0.05);
    expect(tw.visible).toBe("你");
    expect(tw.pausedAtMark).toBe(true); // 到达停顿点，等点击
    tw.click(); // 越过停顿继续打字（非瞬间完成）
    expect(tw.pausedAtMark).toBe(false);
    tw.tick(10); // 继续打完剩余
    expect(tw.done).toBe(true);
    expect(tw.visible).toBe("你好");
  });

  it("未完成点击 → 瞬间完成；完成后点击 → no-op（UI 转 advance）", () => {
    const tw = new Typewriter("abcd", 5);
    tw.tick(0.1);
    expect(tw.visible).toBe("a");
    expect(tw.click()).toBe("completed");
    expect(tw.done).toBe(true);
    expect(tw.visible).toBe("abcd");
    expect(tw.click()).toBe("no-op");
  });

  it("停在 {p} 时点击 → passed-pause（越过停顿而非瞬间完成）", () => {
    const tw = new Typewriter("甲{p}乙丙", 5);
    tw.tick(10);
    expect(tw.pausedAtMark).toBe(true);
    expect(tw.click()).toBe("passed-pause");
    tw.tick(10);
    expect(tw.done).toBe(true);
    expect(tw.visible).toBe("甲乙丙");
  });

  it("多个停顿点逐个消费", () => {
    const tw = new Typewriter("a{p}b{p}c", 5);
    tw.tick(10);
    expect(tw.visible).toBe("a");
    expect(tw.click()).toBe("passed-pause");
    tw.tick(10);
    expect(tw.visible).toBe("ab");
    expect(tw.click()).toBe("passed-pause");
    tw.tick(10);
    expect(tw.done).toBe(true);
    expect(tw.visible).toBe("abc");
  });

  it("cps=0 时 tick 不推进，click 瞬间完成兜底", () => {
    const tw = new Typewriter("xyz", 0);
    tw.tick(10);
    expect(tw.visible).toBe("");
    expect(tw.click()).toBe("completed");
  });
});

describe("样式标记零宽（用户实测回归：打字中裸 `{color=#` 上屏）", () => {
  const line =
    "富文本：{b}加粗{/b}、{i}斜体{/i}、{u}下划线{/u}、{color=#FFD700}金色{/color}、{color=#9ece6a}{size=22}大字{/size}{/color}。";

  it("标记不消耗打字时长：可见字符数才是总数", () => {
    const tw = new Typewriter(line, 10);
    expect(tw.total).toBeLessThan(line.length); // 流内标记不计
  });

  it("打字全程 visible 前缀永不以半截标记结尾（逐 tick 断言）", () => {
    const tw = new Typewriter(line, 200);
    let ticks = 0;
    while (!tw.done && ticks < 2000) {
      tw.tick(0.01);
      ticks += 1;
      expect(tw.visible).not.toMatch(/\{[^}]*$/); // 半截标记 = 未闭合的尾部 {
    }
    expect(tw.done).toBe(true);
  });

  it("打字全程渲染无裸 `{`（渲染协同：前缀经 renderInlineMarkup 干净）", () => {
    const tw = new Typewriter(line, 200);
    let ticks = 0;
    while (!tw.done && ticks < 2000) {
      tw.tick(0.01);
      ticks += 1;
      const html = renderInlineMarkup(tw.visible);
      expect(html.includes("{")).toBe(false);
    }
  });

  it("样式随打字渐进生效：跨过标记后内容按标记着色", () => {
    const tw = new Typewriter("A{color=#FFD700}BC", 10);
    tw.tick(0.1); // budget=1 → shown=1
    expect(tw.visible).toBe("A");
    tw.tick(0.1); // shown=2 → 途经 {color=…} 整段吞入，B 已显示
    expect(tw.visible).toBe("A{color=#FFD700}B");
    expect(renderInlineMarkup(tw.visible)).toContain(
      '<span style="color:#FFD700">B',
    );
  });

  it("打完后返回整条流（含收尾标记，渲染层正常闭合）", () => {
    const tw = new Typewriter("{b}粗{/b}", 10);
    tw.tick(10);
    expect(tw.done).toBe(true);
    expect(tw.visible).toBe("{b}粗{/b}");
    expect(renderInlineMarkup(tw.visible)).toContain("<b>粗</b>");
  });
});
