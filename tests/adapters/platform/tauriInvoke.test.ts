/**
 * Tauri 桥接域的装载期约束：`defaultInvoke` / `defaultListen` 里的动态 import 不能写字面量说明符。
 *
 * 为什么这条要有测试守着：适配器包是给外部工程消费的源码包，而 `@tauri-apps/api` 是它的
 * 依赖、不是消费方工程的依赖。打包器（Rollup 与基于它的 vite / uni）会**静态解析**动态
 * import 的字面量说明符，把它当成真实依赖塞进构建图——于是浏览器与小程序形态明明走不到
 * 桌面分支，却会在构建期以 `Rollup failed to resolve import "@tauri-apps/api/core"` 失败，
 * 除非消费方恰好把该包提升到顶层。写成变量说明符后打包器无法静态解析，只在真正发起
 * 调用时按需装载。
 *
 * 手法：把源码当文本扫（`?raw`），每条断言先自检扫描面非空，再用合成字面量验证正则
 * 既命中该命中的、也不误伤变量写法——「glob 写错 ⇒ 空扫描 ⇒ 绿」是已知假绿形态。
 */
import { describe, expect, it } from "vitest";
// 桥接域的缺省实现不在包对外出口面上（只有适配器工厂用它），故按相对路径取源码
import {
  defaultInvoke,
  defaultListen,
} from "../../../packages/adapters/src/platform/tauri-invoke.ts";

/** 包内全部源码（键 = 相对本测试文件的 glob 模式） */
const PACKAGE_SOURCE_FILES = import.meta.glob(
  "../../../packages/*/src/**/*.ts",
  {
    eager: true,
    query: "?raw",
    import: "default",
  },
) as Record<string, string>;

/** 字面量说明符的动态导入：`import("x")` / `import('x')` / `import(`x`)` */
const LITERAL_DYNAMIC_IMPORT = /await\s+import\s*\(\s*["'`]/;

/** 按文件路径列出命中的行（无命中返回空表） */
function literalDynamicImports(): Array<{ path: string; line: string }> {
  const hits: Array<{ path: string; line: string }> = [];
  for (const [path, source] of Object.entries(PACKAGE_SOURCE_FILES)) {
    for (const line of source.split("\n")) {
      if (LITERAL_DYNAMIC_IMPORT.test(line)) hits.push({ path, line });
    }
  }
  return hits;
}

describe("Tauri 桥接域的动态导入", () => {
  it("扫描面覆盖到桥接域本身", () => {
    const paths = Object.keys(PACKAGE_SOURCE_FILES);
    expect(paths.length).toBeGreaterThan(0);
    expect(
      paths.some((path) => path.endsWith("/platform/tauri-invoke.ts")),
    ).toBe(true);
  });

  it("包内不写字面量说明符的动态导入", () => {
    const hits = literalDynamicImports();
    expect(hits.map((hit) => `${hit.path}: ${hit.line.trim()}`)).toEqual([]);
  });

  it("正则对字面量命中、对变量说明符不命中", () => {
    expect(
      LITERAL_DYNAMIC_IMPORT.test('await import("@tauri-apps/api/core")'),
    ).toBe(true);
    expect(LITERAL_DYNAMIC_IMPORT.test("await import('node:fs')")).toBe(true);
    expect(LITERAL_DYNAMIC_IMPORT.test("await import(`./mod.ts`)")).toBe(true);
    expect(
      LITERAL_DYNAMIC_IMPORT.test(
        "await import(/* @vite-ignore */ CORE_MODULE)",
      ),
    ).toBe(false);
    expect(
      LITERAL_DYNAMIC_IMPORT.test(
        "await import(/* @vite-ignore */ EVENT_MODULE)",
      ),
    ).toBe(false);
  });

  it("缺省实现按契约导出", () => {
    expect(typeof defaultInvoke).toBe("function");
    expect(typeof defaultListen).toBe("function");
  });
});
