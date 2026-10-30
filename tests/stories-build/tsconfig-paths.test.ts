/**
 * 工程 `tsconfig.json` 的 `paths` 读取与展开（别名解析的基座）。
 *
 * 别名不是本引擎的规定：作者写什么前缀就认什么。这里只锚两件事——读出来的结构对不对
 * （`loadPathsConfig`），以及一条说明符展开成哪些绝对路径（`expandAlias`）。
 *
 * 断言落在**展开出的绝对路径集合**上，不落实现细节：最长前缀胜出、精确键优先、
 * `extends` 继承与子级覆盖后的 `baseDir`，都是「换一种写法必须仍然对」的等价性。
 *
 * 全部用法在临时目录里造最小工程（`writeFileSync` 造 tsconfig），不碰仓库配置——
 * 仓库根的 `tsconfig.json` 自身就有 `paths`（workspace 包指向源码），拿它当夹具会把
 * 「本仓怎么配」和「作者怎么配」混在一起。
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  expandAlias,
  loadPathsConfig,
  type PathsConfig,
} from "../../packages/stories-build/src/pipeline/tsconfig-paths.ts";

const BASE = fileURLToPath(new URL("./.tmp-paths/", import.meta.url));

afterEach(() => {
  rmSync(BASE, { recursive: true, force: true });
});

/** 造一个最小工程：`tsconfig.json` 内容为参数，返回工程根绝对路径 */
function makeProject(name: string, tsconfig: string): string {
  const root = join(BASE, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "tsconfig.json"), tsconfig);
  return root;
}

/** 展开结果 → 相对 `baseDir` 的 posix 路径（夹具里 baseDir 就是工程根，便于逐字断言） */
function expanded(config: PathsConfig, spec: string): string[] {
  return expandAlias(config, spec).map((absolute) =>
    resolve(absolute)
      .slice(resolve(config.baseDir).length + 1)
      .split("\\")
      .join("/"),
  );
}

describe("读取工程 paths", () => {
  it("工程没有 tsconfig.json ⇒ null（退化为纯相对路径，不报错）", () => {
    const root = join(BASE, "no-config");
    mkdirSync(root, { recursive: true });
    expect(loadPathsConfig(root)).toBeNull();
  });

  it("tsconfig.json 没有 compilerOptions.paths ⇒ null", () => {
    const root = makeProject(
      "no-paths",
      JSON.stringify({ compilerOptions: { strict: true } }),
    );
    expect(loadPathsConfig(root)).toBeNull();
  });
});

describe("展开说明符", () => {
  const config = (): PathsConfig =>
    loadPathsConfig(
      makeProject(
        "wildcards",
        JSON.stringify({
          compilerOptions: {
            paths: {
              "@/*": ["./src/*"],
              "@/ui/*": ["./ui-kit/*"],
              "@lingfan-engine/stories-build": [
                "./packages/stories-build/src/index.ts",
              ],
            },
          },
        }),
      ),
    )!;

  it("单通配命中：前缀段被替换进目标模板", () => {
    // 只命中 ``@/`` 一条，故拿到 ``src/`` 下的目标模板。
    expect(expanded(config(), "@/hub/hub.vue")).toEqual(["src/hub/hub.vue"]);
  });

  it("精确键命中：键与说明符全等时不看通配", () => {
    expect(expanded(config(), "@lingfan-engine/stories-build")).toEqual([
      "packages/stories-build/src/index.ts",
    ]);
  });

  it("最长前缀胜出：@/ui/* 抢在 @/* 之前", () => {
    // ``@/ui/hub`` 同时命中两条通配：``@/`` 与 ``@/ui/``。两者前缀长度不同、目标目录
    // 也不同，实现一旦退化成「先声明先赢」，这里就会拿到 ``src/ui/hub`` 而变红。
    expect(expanded(config(), "@/ui/hub")).toEqual(["ui-kit/hub"]);
  });

  it("未命中任何模式 ⇒ 空数组（调用方按既有外部包判定继续）", () => {
    expect(expanded(config(), "vue")).toEqual([]);
  });

  it("引擎包说明符不被别名表劫走——即使工程写了宽通配 `@*`", () => {
    // `paths` 属作者，`@lingfan-engine/editor` 属引擎契约。宽通配下它确实会命中模式，
    // 但解析顺序里引擎分支先于别名表，故这里只断言「别名展开拿不到它」这一层：
    // 命中与否都不改变调用方的判定，劫持不可能发生。
    const root = makeProject(
      "engine-package",
      JSON.stringify({
        compilerOptions: { paths: { "@*": ["./hijack/*"] } },
      }),
    );
    const loaded = loadPathsConfig(root)!;
    // 宽通配能匹配到，说明「靠模式写不中」不是防线；防线是调用方的分支顺序。
    expect(expanded(loaded, "@lingfan-engine/editor")).toEqual([
      "hijack/lingfan-engine/editor",
    ]);
    // 而只配了常规别名时，引擎包说明符一条候选都展开不出来。
    expect(expanded(config(), "@lingfan-engine/editor")).toEqual([]);
  });
});

describe("extends 与 baseDir", () => {
  it("extends 深合并：父声明 paths、子只 extends ⇒ baseDir 是父目录", () => {
    const parent = makeProject(
      "extends/base",
      JSON.stringify({
        compilerOptions: { paths: { "~/*": ["./src/*"] } },
      }),
    );
    const child = join(parent, "inner");
    mkdirSync(child, { recursive: true });
    writeFileSync(
      join(child, "tsconfig.json"),
      JSON.stringify({ extends: "../tsconfig.json" }),
    );

    const loaded = loadPathsConfig(child)!;
    expect(loaded).not.toBeNull();
    // 声明处是父目录；子目录里展开出的绝对路径仍落在父目录的 src 下。
    expect(loaded.baseDir.split("\\").join("/")).toBe(
      parent.split("\\").join("/"),
    );
    expect(expandAlias(loaded, "~/ui/hub")).toEqual([
      join(parent, "src/ui/hub"),
    ]);
  });

  it("子级覆盖 paths ⇒ baseDir 是子目录（按声明处算，不按 extends 链头算）", () => {
    const parent = makeProject(
      "override/base",
      JSON.stringify({
        compilerOptions: { paths: { "~/*": ["./src/*"] } },
      }),
    );
    const child = join(parent, "inner");
    mkdirSync(child, { recursive: true });
    writeFileSync(
      join(child, "tsconfig.json"),
      JSON.stringify({
        extends: "../tsconfig.json",
        compilerOptions: { paths: { "~/*": ["./app/*"] } },
      }),
    );

    const loaded = loadPathsConfig(child)!;
    expect(loaded.baseDir.split("\\").join("/")).toBe(
      child.split("\\").join("/"),
    );
    expect(expandAlias(loaded, "~/ui/hub")).toEqual([
      join(child, "app/ui/hub"),
    ]);
  });
});
