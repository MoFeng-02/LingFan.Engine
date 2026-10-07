/**
 * 「应用」按钮的 `dirty` 门**成对**守卫 —— 回归守卫。
 *
 * 用户可见缺陷：文本视图的「✓ 应用到故事」**没有** `:disabled="!dirty"`，而同栏的
 * 「⟳ 重新生成」有、JSON 视图的「✓ 应用」也有 ⇒ 未编辑即点击会 `replaceAll` 一棵
 * **内容相同**的树，**凭空产生一个 undo 单元**（撤销步数被污染），且两视图同类操作
 * 状态不一致。
 *
 * **为什么必须"成对"断言**：这两个视图是同一个交互的两个实现，最容易发生的回归是
 * **只补了其中一个**。所以本文件不分别测"文本视图有门"与
 * "JSON 视图有门"，而是**在同一用例里同时断言两侧**——只改一边就会红。
 *
 * 测试要点：
 * - 源级互锁：两个视图的 apply 按钮**都**必须带 `dirty` 门（成对，防单边回流）
 * - 对照项：断言前先确认**确实取到了两个 apply 按钮**（否则选择器写错会假 PASS）
 * - 约束面：两个视图的 `regenerate` 按钮也**都**要带门（禁用态语义一致）
 * - 剥离注释（守卫对象是模板代码，注释里的说明不算）
 */
import { describe, expect, it } from "vitest";
import textModeSource from "../../apps/editor/src/components/TextModeView.vue?raw";
import jsonViewSource from "../../apps/editor/src/components/JsonView.vue?raw";

/** 剥离注释后再断言——守卫的对象是**模板/代码**，不是注释 */
function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** 取出某个带指定 class 的按钮标签（到 `>` 为止的前半段） */
function buttonTag(source: string, className: string): string {
  const at = source.indexOf(`class="${className}"`);
  if (at < 0) return "";
  const start = source.lastIndexOf("<button", at);
  const end = source.indexOf(">", at);
  return start >= 0 && end > start ? source.slice(start, end + 1) : "";
}

const textCode = stripComments(textModeSource);
const jsonCode = stripComments(jsonViewSource);

describe("对照项：两个视图的 apply 按钮都确实取到了", () => {
  it("文本视图的 apply 标签非空且含事件绑定", () => {
    const tag = buttonTag(textCode, "apply");
    expect(tag.length).toBeGreaterThan(10);
    expect(tag).toContain("@click");
  });

  it("JSON 视图的 apply 标签非空且含事件绑定", () => {
    const tag = buttonTag(jsonCode, "apply");
    expect(tag.length).toBeGreaterThan(10);
    expect(tag).toContain("@click");
  });
});

describe("成对互锁：两个「应用」按钮都必须带 dirty 门（只改一边即红）", () => {
  it("文本视图「✓ 应用到故事」带 :disabled=!dirty", () => {
    expect(buttonTag(textCode, "apply")).toContain(':disabled="!dirty"');
  });

  it("JSON 视图「✓ 应用」带 :disabled=!dirty", () => {
    expect(buttonTag(jsonCode, "apply")).toContain(':disabled="!dirty"');
  });

  it("两侧「⟳ 重新生成」也都带门（禁用态语义一致）", () => {
    for (const code of [textCode, jsonCode]) {
      const i = code.indexOf("⟳ 重新生成");
      expect(i).toBeGreaterThan(-1);
      const tag = code.slice(code.lastIndexOf("<button", i), i);
      expect(tag).toContain(':disabled="!dirty"');
    }
  });
});

describe("防回流：dirty 门的完整形态不得被简写掉", () => {
  it("两个 apply 按钮都不存在「无门」写法（`class=\"apply\"` 后紧跟 @click）", () => {
    for (const code of [textCode, jsonCode]) {
      expect(code).not.toMatch(/class="apply"\s+@click/);
    }
  });
});
