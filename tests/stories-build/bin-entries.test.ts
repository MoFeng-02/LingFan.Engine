/**
 * 编译包的两条**可执行入口**互锁。
 *
 * 本包以 TypeScript 源码出口，Node 的类型擦除拒绝加载 node_modules 里的 `.ts`
 * （`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`），所以装了本包的工程不能
 * `node` 直跑 `src/cli/cli.ts`。对外可执行必须有一层 `.mjs` 垫片：用本包自带依赖
 * `tsx` 装载真实 CLI，再调同一份呈现逻辑——否则「包能装」但「命令行用不了」。
 *
 * 判据四类：
 *   1. `package.json` 的 `bin` 两条都在，且指向真实存在的 `.mjs` 文件；
 *   2. `files` 覆盖 `bin` 目录，否则垫片不会进 tarball；
 *   3. 垫片只做装载，不复制呈现逻辑（不出现 `console.log`），并转调 CLI 具名函数；
 *   4. `tsx` 与 `typescript` 是本包自身依赖——消费方工程不会替它装。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../packages/stories-build",
);

const manifest = JSON.parse(
  readFileSync(join(packageDir, "package.json"), "utf8"),
) as {
  bin?: Record<string, string>;
  files?: string[];
  dependencies?: Record<string, string>;
};

describe("编译包 · 可执行入口", () => {
  it("bin 声明两条入口，且指向真实文件", () => {
    const bin = manifest.bin ?? {};
    expect(Object.keys(bin).sort()).toEqual([
      "lingfan-stories-build",
      "lingfan-stories-watch",
    ]);
    for (const target of Object.values(bin)) {
      expect(target.startsWith("./bin/")).toBe(true);
      expect(existsSync(join(packageDir, target))).toBe(true);
    }
  });

  it("files 覆盖 bin 目录——不写进去垫片就不会进 tarball", () => {
    expect(manifest.files).toContain("bin");
    expect(manifest.files).toContain("src");
  });

  it("垫片只装载与转调，不复制一份呈现逻辑", () => {
    const build = readFileSync(
      join(packageDir, "bin/stories-build.mjs"),
      "utf8",
    );
    const watch = readFileSync(
      join(packageDir, "bin/stories-watch.mjs"),
      "utf8",
    );
    for (const source of [build, watch]) {
      expect(source).toContain('from "tsx/esm/api"');
      expect(source).not.toContain("console.log");
      // npm 在 POSIX 上把 bin 做成软链后直接 exec 该文件：没有 shebang 就是让
      // 内核找不到解释器、退回 shell 解析 JavaScript，命令当场报一堆语法错误。
      expect(source.startsWith("#!/usr/bin/env node\n")).toBe(true);
    }
    expect(build).toContain("runBuildCli");
    expect(watch).toContain("startWatchCli");
  });

  it("tsx 与 typescript 是本包自身依赖，不指望消费方工程提供", () => {
    const dependencies = manifest.dependencies ?? {};
    expect(dependencies.tsx).toBeDefined();
    expect(dependencies.typescript).toBeDefined();
    // esbuild 是常量求值通道的运行时依赖，不能当成可有可无
    expect(dependencies.esbuild).toBeDefined();
  });
});
