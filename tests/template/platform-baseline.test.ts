/**
 * 脚手架平台基线（template-safari13-target）。
 *
 * 移动端老 WebView（基线 Safari 13.1+/Chrome 85+）要能解析脚手架构建产物。esbuild 的
 * `build.target` 决定产物语法下限：缺省目标偏新，产物里会出现基线 WebView 解析不了的
 * 语法，用户工程一打开就白屏。所以模板各形态的 `vite.config.ts` 都要把语法目标钉到
 * `safari13`，与参考宿主 playground 同口径。
 *
 * 注意分工：`build.target` 只转译**语法**，不补基线之后的**内建方法**（`Array.at`、
 * `Object.hasOwn` 等）——那一半由 eslint 的 `lingfan/legacy-webview-compat` 兜底
 * （见 tests/tools/eslint-legacy-domain.test.ts）。两道一起才覆盖老 WebView 兼容。
 */
import { describe, expect, it } from "vitest";

/** 模板各形态的构建配置（骨架 + vue/react/miniprogram overlay） */
const TEMPLATE_VITE = import.meta.glob("../../template/v1/**/vite.config.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** 仓内小程序参考宿主的构建配置 */
const MP_APP_VITE = import.meta.glob("../../apps/miniprogram/vite.config.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** glob 键归一成仓库相对路径（去掉上溯的 `..` 段） */
function repoPath(globKey: string): string {
  return globKey
    .split("/")
    .filter((part) => part !== "..")
    .join("/");
}

/** 按仓库相对路径取源码 */
function sourceAt(sources: Record<string, string>, path: string): string {
  const key = Object.keys(sources).find((k) => repoPath(k) === path);
  expect(key, `找不到 ${path}`).toBeDefined();
  return sources[key!] ?? "";
}

describe("脚手架构建语法目标 safari13（template-safari13-target）", () => {
  it("模板各形态 vite.config 齐全（骨架 + 三 overlay）", () => {
    const paths = Object.keys(TEMPLATE_VITE).map(repoPath).sort();
    expect(paths).toContain("template/v1/__PROJECT__/vite.config.ts");
    expect(paths).toContain("template/v1/overlays/vue/vite.config.ts");
    expect(paths).toContain("template/v1/overlays/react/vite.config.ts");
    expect(paths).toContain("template/v1/overlays/miniprogram/vite.config.ts");
  });

  it.each(Object.keys(TEMPLATE_VITE).map(repoPath))(
    "%s 把 build.target 钉到 safari13",
    (path) => {
      expect(
        sourceAt(TEMPLATE_VITE, path),
        `${path} 缺 build.target=safari13——老 WebView 解析不了偏新语法会白屏`,
      ).toMatch(/target:\s*"safari13"/);
    },
  );

  it("仓内小程序参考宿主同口径 safari13", () => {
    const keys = Object.keys(MP_APP_VITE);
    expect(keys.length, "找不到 apps/miniprogram/vite.config.ts").toBe(1);
    expect(MP_APP_VITE[keys[0]]).toMatch(/target:\s*"safari13"/);
  });
});
