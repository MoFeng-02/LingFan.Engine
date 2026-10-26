/**
 * i18n 工具链 · 翻译面单一事实源。
 *
 * `TRANSLATE_SURFACES` 声明「命令流上哪些 op 的哪些字段会被运行期 Translate」——
 * 诊断的原文收集（`indexStory.originals`）与键抽取器（`extractStoryKeys`）**共同消费本表**，
 * 新增翻译面只改这一处（两侧自动同口径）。元素展示文字（`text`）不在命令流上，
 * 不走此表——由两侧各自的元素遍历单独入集（与运行期 `translateElements` 对齐）。
 *
 * 路径语法：`a.b` 逐段取值；`a[].b` 的 `[]` = 对数组逐项迭代（`options[].text`）。
 */

/** 可翻译原文面（运行期 Translate 挂接：say 文本+说话人 / menu prompt+选项 / input prompt+候选文本 / notify 文本。character.screen 见下——仅入编辑器比对面，运行期不翻） */
export const TRANSLATE_SURFACES: Readonly<Record<string, readonly string[]>> = {
  say: ["text", "speaker"],
  menu: ["prompt", "options[].text"],
  // 候选只翻显示文本；`value` 是要写进变量的原样值，**不进翻译面**（否则多语言下故事逻辑随语言漂移）
  input: ["prompt", "options[].text"],
  notify: ["text"],
  // character.screen 仅入编辑器比对面（原文收集/键抽取），运行期**不翻**：引擎恰好 7 个
  // translate 调用点（runtime/i18n/translate.ts:31、ops/dialog.ts:92/107/171/175、
  // ops/interaction.ts:42、ops/media.ts:262），均不含 screen（说话人显示名解析产物
  // 走 say 的 Translate 挂接，查表见 runtime/ops/dialog.ts execSay；docs concepts/i18n.md 同口径）。
  character: ["screen"],
};

/** 字段路径取值（`a[].b` = 逐项迭代；返回值与其相对指针） */
export function valuesAtPath(
  cmd: Record<string, unknown>,
  path: string,
): { value: unknown; pointer: string }[] {
  let current: { value: unknown; pointer: string }[] = [
    { value: cmd, pointer: "" },
  ];
  for (const segment of path.split(".")) {
    const iterate = segment.endsWith("[]");
    const key = iterate ? segment.slice(0, -2) : segment;
    const next: { value: unknown; pointer: string }[] = [];
    for (const entry of current) {
      if (entry.value === null || typeof entry.value !== "object") continue;
      const child = (entry.value as Record<string, unknown>)[key];
      const childPointer = `${entry.pointer}/${key}`;
      if (iterate) {
        if (Array.isArray(child)) {
          child.forEach((item, index) => {
            next.push({ value: item, pointer: `${childPointer}/${index}` });
          });
        }
      } else {
        next.push({ value: child, pointer: childPointer });
      }
    }
    current = next;
  }
  return current;
}
