/**
 * 词函数**包根出口**互锁。
 *
 * 作者侧约定：宿主工程要写 Stories.src，最自然的取词方式是直接从包根具名导入
 * （`import { say, menu } from "@lingfan-engine/editor"`）。词汇层实际住在
 * `./script` 命名空间里，包根是否真的再导出了这些名字，只有运行时能验证——
 * `export * as script` 是命名空间对象、不是根出口成员。
 *
 * 判据两条：
 *   1. `script` 命名空间里的每个**函数**都必须能从包根具名取到，且是同一个引用
 *      （漏一个就等于文档承诺失效，作者要走解构写法）；
 *   2. 包根不得因此长出别的东西——非函数成员（`SCRIPT_COVERAGE`、`VOCABULARY_OPS`）
 *      仍只经命名空间暴露，避免 `set`/`define`/`wait` 这类常用名在根面被重复声明
 *      到两处。
 */
import { describe, expect, it } from "vitest";
import * as root from "../../packages/editor/src/index";
import * as script from "../../packages/editor/src/script";

/** `script` 命名空间里的函数成员名（词函数与求值辅助，全部都得能从根取） */
const scriptFunctions = Object.entries(script)
  .filter(([, value]) => typeof value === "function")
  .map(([name]) => name)
  .sort();

describe("词函数的包根出口", () => {
  it("扫描面自检：script 命名空间的函数成员非空且含量级正常", () => {
    expect(scriptFunctions.length).toBeGreaterThanOrEqual(70);
    expect(scriptFunctions).toContain("say");
    expect(scriptFunctions).toContain("menu");
  });

  it("每个词函数都能从包根具名取到，且与命名空间里的是同一个引用", () => {
    const missing = scriptFunctions.filter(
      (name) => !(name in (root as Record<string, unknown>)),
    );
    expect(missing).toEqual([]);

    const notSameReference = scriptFunctions.filter(
      (name) =>
        (root as Record<string, unknown>)[name] !==
        (script as Record<string, unknown>)[name],
    );
    expect(notSameReference).toEqual([]);
  });

  it("命名空间照旧可用——根出口新增不夺走 script 面", () => {
    expect(script.say("你好")).toEqual({ op: "say", text: "你好" });
    expect(typeof script.staticFor).toBe("function");
  });

  it("根面不重复暴露非函数成员：它们仍只属于 script 命名空间", () => {
    expect("SCRIPT_COVERAGE" in (script as Record<string, unknown>)).toBe(true);
    expect("SCRIPT_COVERAGE" in (root as Record<string, unknown>)).toBe(false);
    expect("VOCABULARY_OPS" in (root as Record<string, unknown>)).toBe(false);
  });
});
