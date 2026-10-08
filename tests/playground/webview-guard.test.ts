import { describe, expect, it } from "vitest";
import eslintConfigSource from "../../eslint.config.js?raw";
import viteConfigSource from "../../apps/playground/vite.config.ts?raw";

const REQUIRED_SELECTORS = [
  "MemberExpression[property.name='at']",
  "MemberExpression[property.name='findLast']",
  "MemberExpression[property.name='findLastIndex']",
  "MemberExpression[property.name='toSorted']",
  "MemberExpression[property.name='toReversed']",
  "MemberExpression[property.name='toSpliced']",
  "MemberExpression[property.name='with']",
  "MemberExpression[property.name='isWellFormed']",
  "MemberExpression[property.name='toWellFormed']",
  "MemberExpression[object.name='Object'][property.name='hasOwn']",
  "MemberExpression[object.name='Promise'][property.name='any']",
  "MemberExpression[object.name='Array'][property.name='fromAsync']",
  "MemberExpression[object.name='Object'][property.name='groupBy']",
  "MemberExpression[object.name='Map'][property.name='groupBy']",
  "MemberExpression[object.name='AbortSignal'][property.name='timeout']",
  "MemberExpression[object.name='crypto'][property.name='randomUUID']",
];

describe("老 WebView 内建守卫", () => {
  it("守卫块在位：基线（Safari 13.1+/Chrome 85+）之后的内建全拦截", () => {
    expect(eslintConfigSource).toContain("lingfan/legacy-webview-compat");
    for (const selector of REQUIRED_SELECTORS) {
      expect(eslintConfigSource).toContain(selector);
    }
    expect(eslintConfigSource).toContain('name: "structuredClone"');
    expect(eslintConfigSource).toContain('name: "BigInt"');
  });

  it("replaceAll 保持合法（基线内，不得入守卫清单）", () => {
    expect(eslintConfigSource).not.toMatch(/property\.name='replaceAll'/);
  });

  it("语法层兜底在位：vite build.target 维持 safari13", () => {
    expect(viteConfigSource).toContain('target: "safari13"');
  });
});
