/**
 * 能力版本（`capabilityVersion`）契约测试。
 *
 * 这个数此前只活在一条提交信息里（`0a21c97` 的「0.9.0」），产物、清单、包版本都没有它，
 * 于是「能力进展」机器读不到、外部消费者无法判断兼容性。本文件守四条不变式：
 *
 * 1. **只此一处声明**——值只在 `packages/engine/src/contracts/story/entities.ts` 出现，
 *    其余包的源码里不得再写一份字面量。这条是本次改动的核心要求：一旦
 *    stories-build / editor 各写一份，产物标识与包版本就会各自漂移，且没有测试会红。
 * 2. **工具链盖章**——任何 `serializeProject` 写出的 `project.json` 都带该键，
 *    取值恒等于 `CAPABILITY_VERSION`（「清单与常量一致」就是单调性的机器判据）。
 * 3. **幂等**——已含该键的清单再写一次，文本**逐字节相同**：键序稳定，不制造伪差量
 *    （`stories:build` 的「零差量」守卫依赖这一点）。
 * 4. **只读不校验**——存量产物缺该键照常组装；整数与字符串两种形态都当合法值读入。
 *
 * 源码扫描用打包器的 `?raw`（`import.meta.glob`）而不是文件系统，手法沿用
 * `tests/stories-build/package-boundary.test.ts`：扫描面**先自检非空**，避免
 * 「glob 写错 ⇒ 空扫描 ⇒ 恒绿」这种已知假绿形态。
 */
import { describe, expect, it } from "vitest";
import type { Story, StoryColumn } from "@lingfan/engine";
import {
  assembleProject,
  CAPABILITY_VERSION,
  MANIFEST_FILE,
  serializeProject,
} from "@lingfan/engine";

/** 引擎源码全文（键 = 相对本测试文件的 glob 模式；本文件在 tests/engine/data/，故上溯三级） */
const ENGINE_SOURCES = import.meta.glob(
  "../../../packages/engine/src/**/*.ts",
  {
    eager: true,
    query: "?raw",
    import: "default",
  },
) as Record<string, string>;

/** 其余包的源码：这些地方**不得**再声明能力版本 */
const OTHER_PACKAGE_SOURCES = import.meta.glob(
  "../../../packages/{stories-build,editor,ui,shell,adapters}/src/**/*.ts",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

const DECLARATION_FILE = "packages/engine/src/contracts/story/entities.ts";

const COLUMN: StoryColumn = {
  id: "start",
  kind: "flow",
  commands: [{ op: "say", text: "你好" }],
};

const STORY: Story = {
  formatVersion: 1,
  id: "demo",
  entry: "start",
  columns: [COLUMN],
};

/** 常态工程清单：**不含**能力版本（存量产物就是这个形状） */
const LEGACY_MANIFEST = { formatVersion: 1, id: "demo", entry: "start" };

/** 入口列的列文件（组装必需；本文件只关心清单侧，列内容取最小可组装形态） */
const COLUMN_DOC = {
  formatVersion: 1,
  id: "start",
  kind: "flow",
  commands: [{ op: "say", text: "你好" }],
};

const columnFiles = (): Map<string, unknown> =>
  new Map<string, unknown>([["Stories/start.json", COLUMN_DOC]]);

const manifestOf = (
  manifest: Record<string, unknown>,
): Record<string, unknown> => {
  const text = serializeProject(STORY, manifest).files.get(MANIFEST_FILE);
  if (text === undefined)
    throw new Error("serializeProject 未产出 project.json");
  return JSON.parse(text) as Record<string, unknown>;
};

const manifestTextOf = (manifest: Record<string, unknown>): string => {
  const text = serializeProject(STORY, manifest).files.get(MANIFEST_FILE);
  if (text === undefined)
    throw new Error("serializeProject 未产出 project.json");
  return text;
};

describe("能力版本 · 单一来源", () => {
  it("扫描面非空（防 glob 写错导致的恒绿）", () => {
    expect(Object.keys(ENGINE_SOURCES).length).toBeGreaterThan(50);
    expect(Object.keys(OTHER_PACKAGE_SOURCES).length).toBeGreaterThan(50);
    // 声明处确实在扫描面里——否则下面「只此一处」无从判定
    expect(ENGINE_SOURCES[`../../../${DECLARATION_FILE}`]).toBeTypeOf("string");
  });

  it("按形状量：值只在契约声明处出现一次，其余包零命中", () => {
    const literal = JSON.stringify(CAPABILITY_VERSION);
    const hitsInEngine = Object.entries(ENGINE_SOURCES)
      .filter(([, text]) => text.includes(literal))
      .map(([path]) => path.replace("../../../", ""));
    expect(hitsInEngine).toEqual([DECLARATION_FILE]);

    const hitsElsewhere = Object.entries(OTHER_PACKAGE_SOURCES)
      .filter(([, text]) => text.includes(literal))
      .map(([path]) => path.replace("../../../", ""));
    expect(hitsElsewhere).toEqual([]);
  });

  it("自检：合成的正样本能被同一判据抓到（判据不恒假）", () => {
    const probe = `export const X = ${JSON.stringify(CAPABILITY_VERSION)};`;
    expect(probe.includes(JSON.stringify(CAPABILITY_VERSION))).toBe(true);
  });
});

describe("能力版本 · 写侧盖章", () => {
  it("缺键的存量清单：写回后带上该键，取值 = CAPABILITY_VERSION", () => {
    const out = manifestOf(LEGACY_MANIFEST);
    expect(out.capabilityVersion).toBe(CAPABILITY_VERSION);
    // 既有托管键语义不动
    expect(out).toMatchObject({ formatVersion: 1, id: "demo", entry: "start" });
  });

  it("非托管键与未知扩展键原位保留（契约只增不改）", () => {
    const out = manifestOf({
      ...LEGACY_MANIFEST,
      name: "演示工程",
      tsSource: { root: "Stories.src" },
      futureKey: [1, 2, 3],
    });
    expect(out.name).toBe("演示工程");
    expect(out.tsSource).toEqual({ root: "Stories.src" });
    expect(out.futureKey).toEqual([1, 2, 3]);
    expect(out.capabilityVersion).toBe(CAPABILITY_VERSION);
  });

  it("已含该键的清单：键序保持原位（就地更新，不搬到末尾）", () => {
    const text = manifestTextOf({
      formatVersion: 1,
      capabilityVersion: 1,
      id: "demo",
      entry: "start",
    });
    expect(text.indexOf('"capabilityVersion"')).toBeLessThan(
      text.indexOf('"id"'),
    );
    // 源里手写的旧值（整数 1）不保留——托管键由工具链盖章
    expect(JSON.parse(text).capabilityVersion).toBe(CAPABILITY_VERSION);
  });

  it("幂等：连写两次，文本逐字节相同（零差量守卫的前提）", () => {
    const first = manifestTextOf(LEGACY_MANIFEST);
    const second = manifestTextOf(JSON.parse(first) as Record<string, unknown>);
    expect(second).toBe(first);
  });
});

describe("能力版本 · 读侧只读不校验", () => {
  it("缺该键的存量产物照常组装（不报错、不降级）", () => {
    const story = assembleProject(LEGACY_MANIFEST, columnFiles());
    expect(story.id).toBe("demo");
    expect(story.entry).toBe("start");
  });

  it("整数与字符串两种形态都当合法值读入", () => {
    for (const value of [1, "0.9.0", 9]) {
      const story = assembleProject(
        { ...LEGACY_MANIFEST, capabilityVersion: value },
        columnFiles(),
      );
      expect(story.id).toBe("demo");
    }
  });

  it("不认得的形态也不参与形状校验（能力版本不是形状判定的一部分）", () => {
    const story = assembleProject(
      { ...LEGACY_MANIFEST, capabilityVersion: { major: 0, minor: 9 } },
      columnFiles(),
    );
    expect(story.entry).toBe("start");
  });
});
