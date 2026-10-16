/**
 * shell 包宿主纯度互锁（源级扫描，不跑构建）：`packages/shell/**` 是平台无关的
 * 宿主编排层，锁住三条「改动即坏」的契约——
 * 1. 无模块级可变状态（`let`/`var` 只许出现在函数体内）；
 * 2. 无 `document` / `window` 触点（DOM 一律走注入）；
 * 3. 无任何框架 import（Vue/Solid 等响应式由宿主以 Cell 注入，包内不得出现）。
 * 扫描面用 import.meta.glob 以 `?raw` 读源码文本；词法判据前先剥掉注释、
 * 字符串与正则字面量，避免文档注释里的 `document` 等词造成误报。
 */
import { describe, expect, it } from "vitest";

const shellSources = import.meta.glob("../../packages/shell/src/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/**
 * 剥掉行/块注释、字符串/模板字面量与正则字面量，只留代码骨架。
 * 正则字面量用启发式识别：`/` 前一个有效字符是标点（或位于开头）时按正则跳过，
 * 标识符后的 `/` 视为除号——足够覆盖常规排版，同时保证正则里的 `{}` 不干扰括号深度。
 */
function stripToCodeSkeleton(source: string): string {
  let out = "";
  let i = 0;
  const prevSignificant = (): string => {
    for (let j = out.length - 1; j >= 0; j -= 1) {
      if (!/\s/.test(out.charAt(j))) return out.charAt(j);
    }
    return "";
  };
  while (i < source.length) {
    const ch = source.charAt(i);
    const next = i + 1 < source.length ? source.charAt(i + 1) : "";
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      out += " ";
      continue;
    }
    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i += 1;
      while (i < source.length && source.charAt(i) !== ch) {
        if (source.charAt(i) === "\\") i += 1;
        i += 1;
      }
      i += 1;
      out += " ";
      continue;
    }
    if (ch === "/" && "([{,;=:!&|?+-*%~^".includes(prevSignificant())) {
      i += 1;
      while (i < source.length && source.charAt(i) !== "/") {
        if (source.charAt(i) === "\\") i += 1;
        i += 1;
      }
      i += 1;
      while (i < source.length && /[a-z]/i.test(source.charAt(i))) i += 1;
      out += " ";
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * 找骨架里括号深度 0 的 `let` / `var` 声明（= 模块级可变状态）。
 * `for (let i …)` 的循环变量作用域限于循环体，不算模块级状态，跳过。
 */
function firstDepthZeroMutable(skeleton: string): string | null {
  const tokens = skeleton.match(/[{}]|[A-Za-z_$][\w$]*/g) ?? [];
  let depth = 0;
  let prev = "";
  for (const token of tokens) {
    if (token === "{") depth += 1;
    else if (token === "}") depth -= 1;
    else if (
      depth === 0 &&
      (token === "let" || token === "var") &&
      prev !== "for"
    ) {
      return token;
    } else if (/^[A-Za-z_$]/.test(token)) {
      prev = token;
    }
  }
  return null;
}

describe("shell 包宿主纯度（源级扫描）", () => {
  const files = Object.entries(shellSources);
  it("扫描面非空（glob 失配时立刻失败，不许空转通过）", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it("无模块级可变状态：let/var 只许在函数体内", () => {
    for (const [key, raw] of files) {
      const found = firstDepthZeroMutable(stripToCodeSkeleton(raw));
      expect(found, `发现模块级可变状态：${key}`).toBeNull();
    }
  });

  it("无 document/window 触点（DOM 一律经接口注入）", () => {
    for (const [key, raw] of files) {
      const skeleton = stripToCodeSkeleton(raw);
      expect(skeleton, `出现 document：${key}`).not.toMatch(/\bdocument\b/);
      expect(skeleton, `出现 window：${key}`).not.toMatch(/\bwindow\b/);
    }
  });

  it("无框架 import：响应式由宿主以 Cell 注入，包内不得绑定框架", () => {
    for (const [key, raw] of files) {
      expect(raw, `出现框架 import：${key}`).not.toMatch(
        /(from|import)\s*\(?\s*["'](vue|react|solid-js)["']/,
      );
    }
  });
});
