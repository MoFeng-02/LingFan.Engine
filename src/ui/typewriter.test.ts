/** 08-U3 打字机二段式测试：tick 推进、{p}/{w} 段内停顿、点击三态（拟态用户点击节奏） */
import { describe, expect, it } from "vitest";
import { Typewriter, stripPauseMarks } from "./typewriter";

describe("stripPauseMarks", () => {
  it("剥离 {p}/{w} 并记录可见坐标，{fast} 直接删除", () => {
    const r = stripPauseMarks("甲{p}乙{w}丙{fast}丁");
    expect(r.visible).toBe("甲乙丙丁");
    expect(r.pausePoints).toEqual([1, 2]);
  });

  it("其他 {…} 标记保留（{b} 等属于渲染层）", () => {
    expect(stripPauseMarks("{b}粗{/b}").visible).toBe("{b}粗{/b}");
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
