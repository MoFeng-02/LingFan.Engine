/**
 * 灵泛表情差分立绘（资源根逻辑路径，中文目录名原样书写）。
 * 六张透明底 PNG 是作者提供的原始素材，保持原字节，不压缩、不转格式。
 *
 * 情绪表按站点函数共享（复合值不得作模块常量内联，与 stationsMenu 同手法）；
 * 进列先 `portraitXxx()`（hide 幂等 + show，避免同 id 重复追加）；
 * 列内换表情用 `moodXxx()`（style 改 source，同一元素 id 原地换图）。
 * show 无条件追加元素、不按 id 覆盖——同 id 再 show 会产生双元素，禁止。
 * 立绘元素 id 全工程唯一为 "lingfan"，style/animate 按它寻址。
 */
import { script } from "@lingfan-engine/editor";

const { hide, show, style } = script;

/** 进列装载立绘（六情绪各一入口；列切换会清元素层，此处兜直达/重入）。 */
export function portraitNeutral(): void {
  hide("lingfan");
  show("Images/角色/灵泛_正面.png", {
    id: "lingfan",
    x: 860,
    y: 110,
    background: false,
  });
  style("lingfan", { width: 360, height: 560, stretch: "contain" });
}

export function portraitShy(): void {
  hide("lingfan");
  show("Images/角色/灵泛_娇羞.png", {
    id: "lingfan",
    x: 860,
    y: 110,
    background: false,
  });
  style("lingfan", { width: 360, height: 560, stretch: "contain" });
}

/** 列内换表情：style 改 source，同一元素原地换图（不再 show）。 */
export function moodNeutral(): void {
  style("lingfan", { source: "Images/角色/灵泛_正面.png" });
}

export function moodSerious(): void {
  style("lingfan", { source: "Images/角色/灵泛_严肃.png" });
}

export function moodShy(): void {
  style("lingfan", { source: "Images/角色/灵泛_娇羞.png" });
}

export function moodAngry(): void {
  style("lingfan", { source: "Images/角色/灵泛_愤怒.png" });
}

export function moodThinking(): void {
  style("lingfan", { source: "Images/角色/灵泛_手托下巴_疑问.png" });
}

export function moodPuzzled(): void {
  style("lingfan", { source: "Images/角色/灵泛_问号.png" });
}
