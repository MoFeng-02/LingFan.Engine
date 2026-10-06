/**
 * 纯图标按钮**无障碍名**守卫（**回归锚定：真机实测的 a11y 缺陷**）。
 *
 * 症状：顶栏「重开上次工程」`↺` 按钮**功能已实现**（IndexedDB 句柄 +
 * `reopenLastProject`），但 `aria-label=null` ⇒ 无障碍树里只有 `button "↺"`，
 * **读屏用户完全不知道它存在**。`title` 虽有值，但**不进无障碍树**
 *（这是常见误解：浏览器把 `title` 当 tooltip，不当可访问名）。
 *
 * 守卫口径：编辑器内**只有符号/图标、没有文字**的 `<button>` 必须有
 * `aria-label`（`title` 不能替代）。
 *
 * 例外：`aria-label` 为**动态绑定**（`:aria-label="…"`）也算合规 —— 判据只查静态字面量。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = "E:/Project/MyProject/LingFan/LingFan.Engine/apps/editor/src";

/** 递归列出 .vue 文件（编辑器组件 + App.vue） */
function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return vueFiles(p);
    return e.name.endsWith(".vue") ? [p] : [];
  });
}

/** 去掉注释（注释里的示例代码不该参与判据） */
function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 纯符号（无字母数字、无中文）的文本 = 图标按钮的标记 */
function isIconOnly(label: string): boolean {
  const t = label.trim();
  if (t === "") return true; // 空文本（如 `<button class="x"></button>`）也按图标按钮论
  // 有任何可见文字（含中文/字母/数字）⇒ 不是纯图标
  return !/[\p{L}\p{N}]/u.test(t);
}

describe("纯图标按钮 ·必须有可访问名（**用户实测回归**）", () => {
  const files = vueFiles(SRC);
  const violations: string[] = [];

  for (const file of files) {
    const text = stripComments(readFileSync(file, "utf8"));
    // 匹配 <button …>…</button> 与 <button … /> 两形态
    for (const m of text.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
      const attrs = m[1];
      const inner = stripComments(m[2]).replace(/<[^>]+>/g, "").trim();
      if (!isIconOnly(inner)) continue; // 有文字 ⇒ 不必加 aria-label
      const hasAria = /:?aria-label\s*=/.test(attrs);
      const isSubmit = /type\s*=\s*["']submit["']/.test(attrs);
      if (!hasAria && !isSubmit) {
        violations.push(
          `${file.replace(SRC, "src")}: <button${attrs.slice(0, 60)}> 文本=${JSON.stringify(inner.slice(0, 20))}`,
        );
      }
    }
  }

  it("**没有「纯图标按钮缺 aria-label」**（`title` 不替代可访问名）", () => {
    expect(
      violations,
      `这些纯图标按钮缺 aria-label：\n${violations.join("\n")}\n\n` +
        "⇒ 修法：加 :aria-label=\"<人话描述>\"（title 只能当 tooltip，**不进无障碍树**）",
    ).toEqual([]);
  });

  it("审计确实扫到了按钮（守卫本身没空转）", () => {
    // 若 classesOf 之类失效，这里会为 0 ⇒ 守卫形同虚设
    const total = files.reduce((n, f) => {
      const t = stripComments(readFileSync(f, "utf8"));
      return n + [...t.matchAll(/<button\b/g)].length;
    }, 0);
    expect(total, "全组件按钮数不应为 0（否则守卫没在扫）").toBeGreaterThan(30);
  });
});
