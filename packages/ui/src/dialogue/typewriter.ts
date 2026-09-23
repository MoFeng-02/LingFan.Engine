/**
 * 08-U3 打字机二段式（可测纯逻辑，UI 层 rAF 驱动 tick）。
 * - 打字流 = 原文剥离 {p}/{w}/{fast}；**样式标记零宽**：不消耗打字时长、不计入可见字符，
 *   且可见前缀**永不以半截标记结尾**——否则渲染层会把 `{color=#` 之类的残缺标记原样上屏
 *   （用户实测回归，2026-09）
 * - tick(dt) 按 cps 推进已显示的可见字符数；遇停顿点停下等点击
 * - click()：停在 {p}/{w} → 越过停顿继续打字（passed-pause）；未完成 → 瞬间完成（completed）；
 *   已完成 → no-op（UI 转 advance）
 */

export interface TypingStream {
  /** 打字流：原文去 {p}/{w}/{fast}；样式标记整段保留（零宽，渲染层据此着色） */
  stream: string;
  /** 停顿点（可见字符坐标：流内标记零宽不计） */
  pausePoints: number[];
  /** 可见字符总数（流内标记不计） */
  visibleTotal: number;
}

/** 标记分词：{p}/{w} 记停顿点、{fast} 删除、其余 {…} 标记保留在流内（零宽） */
export function tokenizeStream(text: string): TypingStream {
  let stream = "";
  let visibleTotal = 0;
  const pausePoints: number[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch !== "{") {
      stream += ch;
      visibleTotal += 1;
      i += 1;
      continue;
    }
    const end = text.indexOf("}", i);
    if (end < 0) {
      stream += text.slice(i); // 未闭合容错：尾部残缺标记按字面保留
      break;
    }
    const content = text.slice(i + 1, end);
    if (content === "p" || content === "w") {
      pausePoints.push(visibleTotal); // 停顿发生在标记前的可见字符处
      i = end + 1;
      continue;
    }
    if (content === "fast") {
      i = end + 1;
      continue;
    }
    stream += text.slice(i, end + 1); // 样式标记零宽随流
    i = end + 1;
  }
  return { stream, pausePoints, visibleTotal };
}

export class Typewriter {
  private shown = 0; // 已显示的可见字符数（流内标记不计）
  private nextPause = 0; // 下一个未消费的停顿点（在 pausePoints 中的下标）
  private readonly pausePoints: number[];
  private readonly stream: string;
  private readonly visibleTotal: number;

  constructor(
    text: string,
    private readonly cps: number,
  ) {
    const tokenized = tokenizeStream(text);
    this.stream = tokenized.stream;
    this.pausePoints = tokenized.pausePoints;
    this.visibleTotal = tokenized.visibleTotal;
  }

  /** 下一个未消费停顿点的可见坐标（无则 null） */
  private currentPause(): number | null {
    return this.nextPause < this.pausePoints.length
      ? this.pausePoints[this.nextPause]!
      : null;
  }

  tick(dtSeconds: number): void {
    if (this.done || this.pausedAtMark) return;
    const budget = Math.ceil(this.cps * dtSeconds);
    if (budget <= 0) return; // cps=0 → 永不推进（点击兜底完成）
    const pause = this.currentPause();
    const limit = pause === null ? this.visibleTotal : pause;
    this.shown = Math.min(this.shown + budget, limit);
  }

  /** 点击（08-U3 二段式）：停在 {p}/{w} → 越过停顿继续打字；未完成 → 瞬间完成；已完成 → no-op（UI 转 advance） */
  click(): "passed-pause" | "completed" | "no-op" {
    if (this.done) return "no-op";
    if (this.pausedAtMark) {
      this.nextPause += 1;
      return "passed-pause";
    }
    this.shown = this.visibleTotal;
    return "completed";
  }

  get done(): boolean {
    return this.shown >= this.visibleTotal;
  }

  /**
   * 可见前缀：可见坐标 → 流前缀。途经的完整标记整段吞入（渲染层据此着色），
   * 停在刚显示的可见字符处——因此前缀**永不以半截标记结尾**；打完时返回整条流（含收尾标记）。
   */
  get visible(): string {
    if (this.shown >= this.visibleTotal) return this.stream;
    let out = "";
    let visibleCount = 0;
    let i = 0;
    while (i < this.stream.length && visibleCount < this.shown) {
      const ch = this.stream[i]!;
      if (ch !== "{") {
        out += ch;
        visibleCount += 1;
        i += 1;
        continue;
      }
      const end = this.stream.indexOf("}", i);
      if (end < 0) {
        out += this.stream.slice(i); // 理论不达：分词已做未闭合容错
        break;
      }
      out += this.stream.slice(i, end + 1); // 标记零宽：整段吞入
      i = end + 1;
    }
    return out;
  }

  /** 是否停在 {p}/{w} 段内停顿点（点击将越过停顿而非瞬间完成） */
  get pausedAtMark(): boolean {
    const pause = this.currentPause();
    return pause !== null && this.shown >= pause;
  }

  get total(): number {
    return this.visibleTotal;
  }
}
