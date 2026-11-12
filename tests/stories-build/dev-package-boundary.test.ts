/**
 * 直达子路径的边界判据。
 *
 * 这个子路径是「开发期直达某列」这条链路的唯一声明点：参数解析、清单扫描与命令
 * 结果都在它这里。判据钉住三件事——出口面确实暴露了它、出口只做转发（不放实现）、
 * 以及包内相对导入完整指定（包源码要能被原生 ESM 加载）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = fileURLToPath(
  new URL("../../packages/stories-build/", import.meta.url),
);

const MANIFEST = JSON.parse(
  readFileSync(
    new URL("../../packages/stories-build/package.json", import.meta.url),
    "utf8",
  ),
) as { exports?: Record<string, unknown> };

describe("直达子路径 · 包边界", () => {
  it("出口面暴露直达子路径，落点在包内", () => {
    // 运行时落点是装载垫片（.mjs）：Node 拒绝加载 node_modules 里的 .ts，
    // 而消费方正是 Node 直接执行的开发脚本。类型落点仍指向真实实现。
    expect(MANIFEST.exports?.["./dev"]).toEqual({
      types: "./src/dev/index.ts",
      default: "./dev.mjs",
    });
  });

  it("装载垫片只做装载与转发，不放实现", () => {
    const source = readFileSync(
      new URL("../../packages/stories-build/dev.mjs", import.meta.url),
      "utf8",
    );
    expect(source).toContain("tsImport");
    expect(source).toContain("./src/dev/index.ts");
    expect(source).not.toMatch(/export\s+(async\s+)?function\s+\w+\s*\(/);
  });

  it("出口只做转发：不在出口里放实现", () => {
    const source = readFileSync(
      new URL("../../packages/stories-build/src/dev/index.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/export\s+(async\s+)?function/);
    expect(source).not.toMatch(/export\s+class/);
    expect(source).not.toMatch(/export\s+(const|let|var)/);
  });

  it("子路径的四个文件都在包内", () => {
    for (const file of ["index.ts", "args.ts", "entries.ts", "cli.ts"]) {
      expect(() =>
        readFileSync(`${PACKAGE_ROOT}src/dev/${file}`, "utf8"),
      ).not.toThrow();
    }
  });

  it("包内相对导入完整指定（.ts 后缀或目录索引）", () => {
    const relativeSpecifier = /(?:from|import)\s*\(?\s*"(\.{1,2}\/[^"]+)"/g;
    for (const file of ["index.ts", "args.ts", "entries.ts", "cli.ts"]) {
      const source = readFileSync(`${PACKAGE_ROOT}src/dev/${file}`, "utf8");
      for (const match of source.matchAll(relativeSpecifier)) {
        const specifier = match[1] ?? "";
        const complete =
          specifier.endsWith(".ts") || specifier.endsWith("/index.ts");
        expect(complete, `${file} 的相对导入未完整指定：${specifier}`).toBe(
          true,
        );
      }
    }
  });
});
