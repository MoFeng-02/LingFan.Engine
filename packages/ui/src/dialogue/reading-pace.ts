/**
 * 自动播放的阅读节奏（纯函数）：把一句正文折算成「这一句该停多久」。
 *
 * 停留时长不该是定值——同样停 1.2 秒，「嗯。」和一段三行的旁白读起来是两种体验。
 * 所以时长按**词元量**分摊：`基础停留 + 词元量 / 阅读速度`。词元是「眼睛要过一个
 * 单位」的近似，不是字数：
 * - 中日韩字符（含假名、韩文音节）逐字成词元——它们一个字就是一个音节/语素；
 * - 拉丁、数字等其他文字按「连续串」成一个词元——`LingFan` 是一眼，不是七眼；
 * - 空白、标点与符号不计——它们不增加阅读负担；
 * - 内联标记（`{font=…}`、`{p}` 等）不计——玩家看不到它们。
 *
 * 纯函数、零 DOM、零状态：渲染层与宿主共用同一套口径，不做第二份定义。
 */

/** 中日韩字符（平假名、片假名、扩展 A、基本汉字、兼容汉字、韩文音节） */
const RE_CJK =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/u;

/** 单词字符（任何文字的字母与数字） */
const RE_WORD = /[\p{L}\p{N}]/u;

/** 空白、标点与符号（不计阅读负担） */
const RE_FILLER = /[\p{Z}\p{P}\p{S}]/u;

/** 内联标记：与打字机同口径，`{…}` 整段是零宽的控制信息 */
const RE_MARKER = /\{[^{}]*\}/g;

/**
 * 数一句正文的阅读词元量。
 *
 * 入参是**原文**（含内联标记）：先剥标记再数，调用方不必先自行清洗。
 * 空串、纯标点、纯标记都返回 0——此时停留只剩基础时长，不额外加时间。
 */
export function countReadingTokens(text: string): number {
  const plain = text.replace(RE_MARKER, "");
  let tokens = 0;
  /** 是否正处在一个拉丁式单词内部（连续串只算一个词元） */
  let inWord = false;
  for (const ch of plain) {
    if (RE_CJK.test(ch)) {
      // 中日韩逐字成词元；前一个拉丁串到此为止
      tokens += 1;
      inWord = false;
      continue;
    }
    if (RE_FILLER.test(ch)) {
      inWord = false;
      continue;
    }
    if (RE_WORD.test(ch)) {
      if (!inWord) {
        tokens += 1;
        inWord = true;
      }
      continue;
    }
    // 既非文字也非填充（极少数未归类码位）：保守地不计
    inWord = false;
  }
  return tokens;
}

/** 阅读节奏的输入 */
export interface ReadingPaceOptions {
  /** 该句的词元量（见 {@link countReadingTokens}） */
  tokens: number;
  /** 阅读速度（词元/秒）：越大停得越短 */
  readCps: number;
  /** 基础停留（毫秒）：与句长无关的固定部分，也是「短句最少停多久」 */
  baseMs: number;
}

/**
 * 算一句的自动播放停留时长（毫秒，取整）。
 *
 * `baseMs + tokens / readCps * 1000`。`readCps` 非有限或非正时按 1 兜底——速度是除数，
 * 0 会让停留变成无穷（自动播放卡死在这一句），故不在调用方各自防。
 */
export function autoDwellMs(options: ReadingPaceOptions): number {
  const { tokens, baseMs } = options;
  const cps =
    Number.isFinite(options.readCps) && options.readCps > 0
      ? options.readCps
      : 1;
  const safeTokens = Number.isFinite(tokens) && tokens > 0 ? tokens : 0;
  return Math.round(baseMs + (safeTokens / cps) * 1000);
}
