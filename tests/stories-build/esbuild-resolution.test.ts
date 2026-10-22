/**
 * 编译期求值器的 esbuild 解析锚点：包化之后最容易无声坏掉的一条链路。
 *
 * 背景：`const-eval.ts` 从 `apps/playground/scripts/build/` 搬进
 * `packages/stories-build/src/` 后，`createRequire(import.meta.url).resolve("esbuild")`
 * 的锚点跟着换到了包内。旧位置向上走能碰到 `apps/playground/node_modules/esbuild`，
 * 新位置向上只有包自己的 `node_modules` —— 包清单里没声明 esbuild 时，这一段在
 * 裸 node 下必然 MODULE_NOT_FOUND。当时没人发现，是因为 `pnpm stories:build` 走
 * tsx，而 **tsx 会修补 CJS 解析**，把缺口盖住了：真实环境里模板工程 `pnpm add
 * @lingfan-engine/stories-build` 装不到 esbuild，求值段直接失败，且错误文案还指向
 * apps/playground，照做也扑空。
 *
 * 所以本文件的断言必须**跨进程跑裸 node**：vitest 自己就跑在 tsx/vite 管线里，
 * 同进程调用会被同一层解析补丁救活，永远复现不了这个缺陷（假绿）。子进程用
 * `process.execPath`，拿到的就是当前 node 本体。
 *
 * 另外两条是「清单与文案也得读实物」：依赖声明读真 package.json（防「
 * 只测合成字面量、实物却缺项」的假绿），排障文案读真源码（消费者唯一线索，陈旧即误导）。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const CONST_EVAL_PATH = path.join(
  repoRoot,
  "packages",
  "stories-build",
  "src",
  "const-eval",
  "const-eval.ts",
);
const MANIFEST_PATH = path.join(
  repoRoot,
  "packages",
  "stories-build",
  "package.json",
);

/**
 * 探针里的锚点占位符。裸 URL 会被 Node 警告成「像 import 调用」的歧义表达式
 * （`(node:xxxx) [DEP0169]` 一行污染 stdout），故用引号包起来——也因此这里换锚点
 * 靠 replace 一个占位符，而不是重新拼 JSON.stringify。
 */
const ANCHOR_PLACEHOLDER = "__ANCHOR_URL__";
const REAL_ANCHOR_URL = JSON.stringify(pathToFileURL(CONST_EVAL_PATH).href);
const ORPHAN_ANCHOR_URL = JSON.stringify(
  pathToFileURL(path.join(repoRoot, "docs", "const-eval.ts")).href,
);

/** 子进程里跑的探针：打印解析结果或错误码，成败都退出 0，由 stdout 判定。 */
const PROBE = [
  "const { createRequire } = require('node:module');",
  `const anchor = ${ANCHOR_PLACEHOLDER};`,
  "try {",
  "  console.log('RESOLVED ' + createRequire(anchor).resolve('esbuild'));",
  "} catch (error) {",
  "  console.log('FAILED ' + (error && error.code));",
  "}",
].join("\n");

/**
 * 跑探针。**必须把 NODE_PATH 摘掉**：vitest 会把自己的 node_modules 链塞进这个变量
 * 传给孩子进程，而 `require.resolve` 的全局路径回退会去那里找——同一个
 * `docs/const-eval.ts` 锚点，带 NODE_PATH 时能解析到 esbuild、摘掉后 FAILED。
 * 不摘，这条测试就永远绿：它测到的是 vitest 的环境，不是包自身的可解析性。
 */
function runProbe(anchorUrl: string): string {
  const script = PROBE.replace(ANCHOR_PLACEHOLDER, anchorUrl);
  const env = { ...process.env };
  delete env.NODE_PATH;
  return execFileSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    env,
  }).trim();
}

describe("创作链编译包 · 求值器的 esbuild 解析", () => {
  it("包内解析 esbuild 不依赖 tsx 补丁：裸 node 子进程里也必须解析成功", () => {
    // 先证明这条探针真的在测解析：把锚点换成一个没有 node_modules 的目录，必须失败。
    // 否则「解析成功」可能只是因为探针写错了、或子进程继承了调用方的解析路径。
    const orphanOutput = runProbe(ORPHAN_ANCHOR_URL);
    expect(orphanOutput).toBe("FAILED MODULE_NOT_FOUND");

    const output = runProbe(REAL_ANCHOR_URL);

    expect(output.startsWith("RESOLVED ")).toBe(true);
    const resolved = output.slice("RESOLVED ".length);
    expect(path.isAbsolute(resolved)).toBe(true);
    // 必须落在真 esbuild（包入口），而不是别处同名文件。
    expect(resolved).toMatch(/esbuild[\\/]lib[\\/]main\.js$/);
    expect(() => readFileSync(resolved, "utf8")).not.toThrow();
  });

  it("包清单真声明了 esbuild：读实物 dependencies，不是合成字面量", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(manifest.dependencies?.esbuild).toBe("^0.28.2");
    // 运行期依赖不能塞进 devDependencies：模板工程装包时不会带上它。
    expect(manifest.devDependencies?.esbuild).toBeUndefined();
  });

  it("缺 esbuild 的排障文案指向本包：不得再把消费者引向 apps/playground", () => {
    const source = readFileSync(CONST_EVAL_PATH, "utf8");
    const messageLine = source
      .split("\n")
      .find((line) => line.includes("esbuild 未解析到"));

    expect(typeof messageLine).toBe("string");
    expect(messageLine).toContain("@lingfan-engine/stories-build");
    expect(messageLine).not.toContain("apps/playground");
    // 整个求值器都不该再提宿主工程——包不知道谁在调它。
    expect(source).not.toContain("apps/playground");
  });
});
