/**
 * 08-U3 打字机二段式（可测纯逻辑，UI 层 rAF 驱动 tick）。
 * - tick(dt) 按 cps 推进已显示字符数；遇 {p}/{w} 段内停顿点停下等点击
 * - click()：停在 {p}/{w} → 越过停顿继续打字（passed-pause）；未完成 → 瞬间完成（completed）；已完成 → no-op（UI 转 advance）
 * - 停顿标记在推进坐标中占位但不计入可见字符（渲染层剥离标记）
 */

/** 从文本中剥离 {p}/{w} 标记，返回渲染文本与标记的「可见坐标」位置（升序） */
export function stripPauseMarks(text: string): {
  visible: string;
  pausePoints: number[];
} {
  let visible = "";
  const pausePoints: number[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch !== "{") {
      visible += ch;
      i += 1;
      continue;
    }
    const end = text.indexOf("}", i);
    if (end < 0) {
      visible += text.slice(i);
      break;
    }
    const content = text.slice(i + 1, end);
    if (content === "p" || content === "w") {
      pausePoints.push(visible.length); // 停顿发生在标记前的可见字符处
      i = end + 1;
      continue;
    }
    if (content === "fast") {
      i = end + 1;
      continue;
    }
    visible += text.slice(i, end + 1);
    i = end + 1;
  }
  return { visible, pausePoints };
}

export class Typewriter {
  private shown = 0; // 已显示的可见字符数
  private nextPause = 0; // 下一个未消费的停顿点（在 marks 中的下标）
  private readonly marks: number[];
  private readonly visibleText: string;

  constructor(
    visibleText: string,
    private readonly cps: number,
  ) {
    const stripped = stripPauseMarks(visibleText);
    this.visibleText = stripped.visible;
    this.marks = stripped.pausePoints;
  }

  /** 下一个未消费停顿点的可见坐标（无则 null） */
  private currentPause(): number | null {
    return this.nextPause < this.marks.length
      ? this.marks[this.nextPause]!
      : null;
  }

  tick(dtSeconds: number): void {
    if (this.done || this.pausedAtMark) return;
    const budget = Math.ceil(this.cps * dtSeconds);
    if (budget <= 0) return; // cps=0 → 永不推进（点击兜底完成）
    const pause = this.currentPause();
    const limit = pause === null ? this.visibleText.length : pause;
    this.shown = Math.min(this.shown + budget, limit);
  }

  /** 点击（08-U3 二段式）：停在 {p}/{w} → 越过停顿继续打字；未完成 → 瞬间完成；已完成 → no-op（UI 转 advance） */
  click(): "passed-pause" | "completed" | "no-op" {
    if (this.done) return "no-op";
    if (this.pausedAtMark) {
      this.nextPause += 1;
      return "passed-pause";
    }
    this.shown = this.visibleText.length;
    return "completed";
  }

  get done(): boolean {
    return this.shown >= this.visibleText.length;
  }

  get visible(): string {
    return this.visibleText.slice(0, this.shown);
  }

  /** 是否停在 {p}/{w} 段内停顿点（点击将越过停顿而非瞬间完成） */
  get pausedAtMark(): boolean {
    const pause = this.currentPause();
    return pause !== null && this.shown >= pause;
  }

  get total(): number {
    return this.visibleText.length;
  }
}
