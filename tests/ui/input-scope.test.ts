/**
 * UI 容器标记：属性名只声明一处，选择器由它拼出。
 *
 * 事件目标判据靠一个 CSS 选择器把「控件/面板内」与「舞台上」分开，而面板根上那个属性名
 * 是整条判据的唯一锚点。它一旦在某处被另抄一份字面量，两边就会各自演化：属性改了名，
 * 选择器还在找旧名，判据静默失配——面板里滚动不再被拦住，输入框里的按键照旧被叙事层
 * 吃掉，而编译通过、行为用例也看不出问题（都还是「能跑」）。这里守三件运行期看不见的事：
 *
 * 1. 该属性名在作者源码里只出现一处字符串字面量（其余消费面一律 import 常量）；
 * 2. 选择器由常量拼出，不另抄字面量；
 * 3. 判据确实按这个属性名路由——替身声明「只认选择器里点名了这个属性」，
 *    常量或选择器任一处走偏，命中结论都会反过来。
 *
 * `.vue` 模板里直接写 `data-ui-zone` 这类 HTML 属性是合法的（模板无法 import TS 常量），
 * 它不带引号、不是字符串字面量，因此不在第 1 条的扫描口径内；测试目录自身也排除在外，
 * 否则本文件里的期望值会被算成第二处声明。
 */
import { describe, expect, it } from "vitest";
import {
  GAME_INPUT_BLOCKED_SELECTOR,
  UI_ZONE_ATTRIBUTE,
  isGameInputTarget,
  routesToNarrative,
  type ClosestLike,
} from "@lingfan-engine/ui";

/**
 * 作者源码扫描面：只取包内 `src/`（模板工程副本与测试不在其内）。
 * 断言以原文（`?raw`）为准，不经类型系统——要守的正是「源码里写了几份字面量」。
 */
const PACKAGE_SOURCES = import.meta.glob("../../packages/*/src/**/*.{ts,vue}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** glob 键 → 仓库相对路径（posix），失败信息里直接可跳转 */
function rel(key: string): string {
  return key.replace(/^\.\.\/\.\.\//, "").replace(/\\/g, "/");
}

/** 去注释：注释里举例写的属性名不算声明（保留 `://` 里的双斜杠） */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

/** 带引号的属性名字面量：模板 HTML 属性（无引号）与注释都不命中 */
const ATTRIBUTE_LITERAL = /(["'`])data-ui-zone\1/g;

/** 全部字面量出现点，形如 `path:line` */
function literalSites(): string[] {
  const sites: string[] = [];
  for (const [key, raw] of Object.entries(PACKAGE_SOURCES)) {
    const code = stripComments(raw);
    for (const match of code.matchAll(ATTRIBUTE_LITERAL)) {
      const line = code.slice(0, match.index).split("\n").length;
      sites.push(`${rel(key)}:${line}`);
    }
  }
  return sites.sort();
}

/** 判据与常量的声明文件原文（按路径尾段取，不依赖 glob 键的具体形态） */
function sourceOf(suffix: string): string {
  const key = Object.keys(PACKAGE_SOURCES).find((key) =>
    rel(key).endsWith(suffix),
  );
  if (key === undefined) {
    throw new Error(`扫描面缺 ${suffix}：glob 模式与目录结构失配`);
  }
  return PACKAGE_SOURCES[key] ?? "";
}

/**
 * 最小替身：只实现契约里用到的 `closest(selector)`。
 *
 * `insideUiZone` 为真时，仅当选择器点名了该属性才命中——替身不认「某个固定选择器字符串」，
 * 因此常量与选择器之间的拼装关系坏了，结论会从「非游戏域」翻回「游戏域」。
 */
function targetMock(insideUiZone: boolean): {
  el: ClosestLike;
  seen: string[];
} {
  const seen: string[] = [];
  const marker = `[${UI_ZONE_ATTRIBUTE}]`;
  return {
    seen,
    el: {
      closest(selector: string) {
        seen.push(selector);
        return insideUiZone && selector.includes(marker) ? {} : null;
      },
    },
  };
}

describe("属性名单一来源：作者源码里只允许一处字符串字面量", () => {
  it("唯一一处就是常量声明，其余消费面须 import", () => {
    const sites = literalSites();
    expect(
      sites,
      `属性名字面量出现点：${sites.join(", ") || "(无)"}`,
    ).toHaveLength(1);
    expect(sites[0]?.replace(/:\d+$/, "")).toBe(
      "packages/ui/src/input/scope.ts",
    );
  });
});

describe("选择器由常量拼出：不另抄字面量", () => {
  it("声明行用模板插值引用常量，且不写裸属性名", () => {
    const source = sourceOf("packages/ui/src/input/scope.ts");
    const declLine = source
      .split("\n")
      .find((line) => line.includes("GAME_INPUT_BLOCKED_SELECTOR ="));
    expect(declLine).toBeDefined();
    expect(declLine).toContain("${UI_ZONE_ATTRIBUTE}");
    expect(declLine).not.toContain("data-ui-zone");
  });

  it("运行值里的属性段就是常量本身", () => {
    expect(GAME_INPUT_BLOCKED_SELECTOR).toContain(`[${UI_ZONE_ATTRIBUTE}]`);
  });
});

describe("判定行为：面板/控件内不吃输入，舞台上才归叙事", () => {
  it("面板内（带属性）⇒ 非游戏输入、不归叙事", () => {
    const { el, seen } = targetMock(true);
    expect(isGameInputTarget(el)).toBe(false);
    expect(routesToNarrative("dialogue", el)).toBe(false);
    // 判据问的就是这一个选择器，没有第二套（两次判定各问一次）
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([GAME_INPUT_BLOCKED_SELECTOR]));
  });

  it("舞台上（不带属性）⇒ 游戏输入、对话域归叙事", () => {
    const { el } = targetMock(false);
    expect(isGameInputTarget(el)).toBe(true);
    expect(routesToNarrative("dialogue", el)).toBe(true);
  });

  it("非对话域一律不归叙事，与目标是否在控件内无关", () => {
    for (const scope of ["world", "ui"] as const) {
      expect(routesToNarrative(scope, targetMock(true).el)).toBe(false);
      expect(routesToNarrative(scope, targetMock(false).el)).toBe(false);
      expect(routesToNarrative(scope, null)).toBe(false);
    }
  });

  it("不具备 closest 能力的目标保守视为游戏域", () => {
    expect(isGameInputTarget(null)).toBe(true);
    expect(isGameInputTarget({})).toBe(true);
  });
});

describe("对外契约：包根出口与属性值的稳定性", () => {
  it("包根同时暴露常量与判据（宿主与嵌入方只从这里取）", () => {
    expect(typeof UI_ZONE_ATTRIBUTE).toBe("string");
    expect(typeof GAME_INPUT_BLOCKED_SELECTOR).toBe("string");
    expect(typeof isGameInputTarget).toBe("function");
    expect(typeof routesToNarrative).toBe("function");
  });

  it("属性值是对外契约——宿主与第三方面板按这个名字打标，不得漂移", () => {
    expect(UI_ZONE_ATTRIBUTE).toBe("data-ui-zone");
  });
});
