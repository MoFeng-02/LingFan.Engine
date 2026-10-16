/**
 * 诊断面板**类名隔离**守卫（回归）。
 *
 * 症状：新写的诊断分组用了通用类名 `.group-head`，而 `ColumnList` /
 * `ComponentPalette` / `StageEditor` **早就在用同一个类名** ⇒ 探针按类名选择器
 * 点组头时点到的是**别的面板的组头**（「组头数」与预期不符，点开的是
 * 舞台的元素）。
 *
 * 根因不是逻辑，是**CSS 类名没有组件作用域**（scoped style 只作用于本组件模板，
 * 但**类名字符串本身**在 DOM 里是全局可见的，跨组件同名字段会互相干扰）。
 *
 * 守卫口径：**诊断面板用的一切类名必须带 `diag-` 前缀**（含子元素），
 * 且**不得与其他组件的类名重名**。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const COMPONENTS = fileURLToPath(
  new URL("../../apps/editor/src/components", import.meta.url),
);

/** 诊断面板自身（按栏分组后位于 `panels/`；扫描面则是**整个组件树**） */
const PANEL = "panels/DiagnosticsPanel.vue";

/**
 * 递归收集组件树里的全部 `.vue`。
 *
 * **必须递归**：组件按栏分组后目录不再平铺，`readdirSync` 平扫只会拿到 0 个
 * `.vue` —— 那时「不与其他组件重名」会因为**扫描面为空**而恒真（判据绿但守卫失效）。
 */
function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return vueFiles(full);
    if (!entry.name.endsWith(".vue")) return [];
    return [relative(COMPONENTS, full).replace(/\\/g, "/")];
  });
}

/**
 * 组件模板里出现的静态 class 名。
 *
 * **只取纯类名 token**：`class="a"`:class="cond ? 'x' : 'y'"` 这类混写里，
 * 动态片段不是类名，取出来会造成**假撞名**。三类假阳性：
 * ① `:class="{ collapsed: cond }"` 的 `{ collapsed: … }`；② 三元表达式里的 `'y'`；
 * ③ Vue 指令属性 `v-if="a === b"` 被跨引号配对误吞（`===` 当成类名）。
 *
 * 判据：token 必须是 **纯 CSS 标识符**（`[-_a-zA-Z][-_a-zA-Z0-9]*`），
 * 含 `{` `[` `(` `:` `.` `'` `"` `=` `空格` 的一律跳过。
 */
function classesOf(file: string): Set<string> {
  const text = readFileSync(join(COMPONENTS, file), "utf8");
  const out = new Set<string>();
  for (const m of text.matchAll(/class="([^"]*)"/g)) {
    for (const token of m[1].split(/\s+/)) {
      const t = token.trim();
      if (!/^[-_a-zA-Z][-_a-zA-Z0-9]*$/.test(t)) continue; // 动态表达式片段，不是类名
      out.add(t);
    }
  }
  return out;
}

const componentFiles = vueFiles(COMPONENTS);

/** 组件树规模下限——扫描面塌成空集时，下面的「不重名」会恒真（守卫失效） */
const MIN_COMPONENT_FILES = 30;

describe("诊断面板 · 类名隔离", () => {
  it("扫描面覆盖分组后的整个组件树（平扫会漏掉 4 个分组）", () => {
    expect(componentFiles.length).toBeGreaterThanOrEqual(MIN_COMPONENT_FILES);
    expect(componentFiles).toContain(PANEL);
    expect(
      componentFiles.filter((f) => f.includes("/")).length,
    ).toBeGreaterThan(0);
  });

  it("诊断面板的类名**全部带 `diag-` 前缀**", () => {
    const own = classesOf(PANEL);
    expect(own.size).toBeGreaterThan(0);
    const bare: string[] = [...own].filter((c) => !c.startsWith("diag-"));
    expect(bare, `这些类名缺 diag- 前缀：${bare.join("、")}`).toEqual([]);
  });

  it("**诊断面板类名不与其他组件重名**（撞名会让选择器/探针指向别的面板）", () => {
    const own = classesOf(PANEL);
    const clashes: string[] = [];
    for (const file of componentFiles) {
      if (file === PANEL) continue;
      for (const c of classesOf(file)) {
        if (own.has(c)) clashes.push(`${file}: ${c}`);
      }
    }
    expect(clashes, `类名撞车：\n${clashes.join("\n")}`).toEqual([]);
  });

  it("组头类名带 `diag-` 前缀且**全仓唯一**", () => {
    const own = classesOf(PANEL);
    // 组头是本面板的核心交互目标（类名全局撞名即误伤，故必须带 diag- 前缀）
    const heads = [...own].filter((c) => c.includes("head"));
    expect(heads.length).toBeGreaterThan(0);
    for (const h of heads) expect(h.startsWith("diag-")).toBe(true);
  });
});
