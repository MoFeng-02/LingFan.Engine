/**
 * 默认语言码单一声明与同值判据（契约缺省语义一处声明，消费方引用同一份）。
 *
 * 为什么要有：默认语言 `"zh-CN"` 曾在 shell 门面与 adapters Web 端口各写一份
 * `const DEFAULT_LANG`，两处会各自演化——门面缺省列表与供给端口 `listLanguages`
 * 的「恒含居首」可能悄悄指向不同语言。本判据钉两件事：
 * 1. 声明唯一：作者源码里 `const DEFAULT_LANG =` 只在 core 契约层出现一次；
 * 2. 三处同值：core 常量、shell 门面缺省列表、adapters 端口 `listLanguages`
 *    的居首项取到同一个值（运行期行为口径，不是注释口径）。
 */
import { DEFAULT_LANG } from "@lingfan-engine/core";
import { createHttpI18nPort } from "@lingfan-engine/adapters";
import { createHostI18n, type HostI18nEngine } from "@lingfan-engine/shell";
import { describe, expect, it } from "vitest";

const SOURCES = import.meta.glob(
  [
    "../../packages/*/src/**/*.{ts,vue}",
    "../../apps/*/src/**/*.{ts,vue}",
    "../../template/*/__PROJECT__/src/**/*.{ts,vue}",
    // 叠加层组合根也在单一声明判据面内（vue/react/tauri/story 各形态的 src）
    "../../template/*/overlays/*/src/**/*.{ts,vue,tsx}",
    "!../../apps/*/src/Stories.src/**",
    "!../../template/*/__PROJECT__/src/Stories.src/**",
  ],
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** glob 键 → 仓库相对路径（posix） */
function rel(key: string): string {
  return key.replace(/^\.\.\/\.\.\//, "").replace(/\\/g, "/");
}

/** 去注释（块注释 + 行注释）：注释里的示例不算声明 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

/** 引擎替身（契约窄面）：门面语言列表用例只读缺省值，不触发任何引擎行为 */
const idleEngine: HostI18nEngine = {
  translate: (text) => text,
  setLanguage: async () => undefined,
  onStateChanged: () => () => undefined,
  get: () => undefined,
};

describe("默认语言码单一声明", () => {
  it("core 契约常量就是 zh-CN（契约缺省语义的唯一声明处）", () => {
    expect(DEFAULT_LANG).toBe("zh-CN");
  });

  it("const DEFAULT_LANG 声明只在 core 契约层出现一次", () => {
    const declaring = Object.entries(SOURCES)
      .filter(([, source]) =>
        /^\s*(?:export\s+)?const\s+DEFAULT_LANG\s*=/m.test(
          stripComments(source),
        ),
      )
      .map(([key]) => rel(key));
    expect(declaring).toEqual([
      "packages/core/src/contracts/story/entities.ts",
    ]);
  });

  it("三处同值：core 常量 = shell 门面缺省列表 = adapters 端口居首语言", async () => {
    // shell 门面：未接供给时缺省列表只有默认语言
    const facade = createHostI18n(idleEngine);
    expect(facade.availableLangs).toEqual([DEFAULT_LANG]);
    // adapters 端口：空清单也要恒含默认语言且居首
    const port = createHttpI18nPort({
      langs: [],
      fetch: async () => {
        throw new Error("不应取件");
      },
    });
    expect(await port.listLanguages?.()).toEqual([DEFAULT_LANG]);
    // 供给漏报默认语言时门面补插的也是同一个值
    const supplied = createHostI18n(idleEngine, {
      i18nPort: { listLanguages: async () => ["en"] },
    });
    await Promise.resolve();
    expect(supplied.availableLangs).toEqual([DEFAULT_LANG, "en"]);
  });
});
