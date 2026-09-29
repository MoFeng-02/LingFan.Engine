/**
 * 05 i18n 工具链 · 翻译面单一事实源（T05-01，锚点: i18n-key-extract-parity）。
 *
 * `TRANSLATE_SURFACES` 声明「命令流上哪些 op 的哪些字段会被运行期 Translate」——
 * 诊断的原文收集（`indexStory.originals`）与键抽取器（`extractStoryKeys`）**共同消费本表**，
 * 新增翻译面只改这一处（两侧自动同口径）。元素展示文字（`text`）不在命令流上，
 * 不走此表——由两侧各自的元素遍历单独入集（与运行期 `translateElements` 对齐）。
 *
 * 路径语法：`a.b` 逐段取值；`a[].b` 的 `[]` = 对数组逐项迭代（`options[].text`）。
 */

/** 可翻译原文面（运行期 Translate 挂接：say 文本+说话人 / menu prompt+选项 / input prompt / notify 文本 / character 显示名） */
export const TRANSLATE_SURFACES: Readonly<Record<string, readonly string[]>> = {
  say: ["text", "speaker"],
  menu: ["prompt", "options[].text"],
  input: ["prompt"],
  notify: ["text"],
  // 2026-09-27 翻译面扩展（用户裁定「所有展示文字纳入翻译」）：角色注册的显示名 screen
  // （说话人显示名解析产物走 say 的 Translate 挂接，查表见 runtime/engine.ts execSay）。
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
