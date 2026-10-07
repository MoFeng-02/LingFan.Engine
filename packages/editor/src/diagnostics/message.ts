/**
 * 诊断文案 · **主句 / 说明分层**（纯函数，可测）。
 *
 * 存在理由：诊断 `message` 原先把「状态」和「怎么处置」塞进同一句——
 * 例：`未使用的译文键：第三章 · 相遇（say / menu / input / notify 四个翻译面均未命中原文——该键运行期不会生效；若这段文字只用于元素文本或宿主界面，本条可忽略）`。
 * 括号里那段**明说「可忽略」**却占主句 3/4 篇幅 ⇒ 320px 窄栏里每条竖排 5~6 行，
 * **扫读成本极高**。
 *
 * 分层后：主句只说状态（进列表、可扫读），说明进 `title`/次要行（按需展开）。
 *
 * **不改 `Diagnostic.message` 的既有形状**（契约字段、诊断码、pointer 都不动）——
 * 拆的是**渲染分层**：`detailOf(diagnostic)` 从 message 里切出「主句 / 说明」，
 * 这样**既有测试与消费方全部不受影响**（不制造第二份文案事实源）。
 */

/** 拆出的一层文案 */
export interface DiagnosticMessageParts {
  /** 主句：状态本身（列表里显示的就是它） */
  readonly brief: string;
  /** 说明：怎么处置 / 为什么（默认收起，悬停或展开可见）；无说明时为空串 */
  readonly detail: string;
}

/**
 * 从 `message` 切出主句与说明。
 *
 * 判据：**首个全角括号及其后内容**算说明（现有 4 条诊断的说明都在括号里，
 * 且括号内不含右括号以外的结构）。没括号 ⇒ 整句是主句、无说明。
 *
 * **不切 `pointer`**：pointer 是另一个字段，不参与文案分层。
 */
export function splitDiagnosticMessage(message: string): DiagnosticMessageParts {
  const start = message.indexOf("（");
  if (start <= 0) return { brief: message, detail: "" };
  // 说明本身若含「（…）」嵌套，只取到**配对**的右括号
  let depth = 0;
  let end = -1;
  for (let i = start; i < message.length; i += 1) {
    if (message[i] === "（") depth += 1;
    else if (message[i] === "）") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return { brief: message, detail: "" };
  return {
    brief: message.slice(0, start).trimEnd(),
    detail: message.slice(start + 1, end).trim(),
  };
}

/** 列表里显示的主句（便捷出口） */
export function diagnosticBrief(message: string): string {
  return splitDiagnosticMessage(message).brief;
}
