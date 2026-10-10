/**
 * 编辑器包结构不变式互锁测试：包按「契约层 / 域出口 / 实现叶子」拆分后，三条
 * 结构约定目前没有测试守着，下一次改动可能无声地破坏它们。这里沿用
 * tests/engine/runtime/scene-type.test.ts 的手法，用打包器的 ?raw 读取把源码
 * 当文本断言（前端不碰文件系统）：
 * 1. 契约层只放类型：contracts/** 内不得出现 export function / export class；
 * 2. 包内无跨域深引：from "../<域>/<文件>" 形态为 0（指向域出口的 from "../<域>" 合规）；
 * 3. 被拆掉的旧扁平文件不得复活：同名 .ts 会优先于目录被解析，残留 = 拆分失效。
 * 每条断言先自检扫描面非空并验证正则可命中已知样本，防止「glob 写错 ⇒ 空扫描 ⇒ 恒真」。
 */
import { describe, expect, it } from "vitest";

/** 编辑器包全部源码，键 = 相对本测试文件的路径（打包器读取，前端不碰文件系统） */
const EDITOR_SOURCES = import.meta.glob("../../packages/editor/src/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const SOURCE_KEYS = Object.keys(EDITOR_SOURCES);

// 跨域深引判据（与包内既有扫描口径一致）：`from "../<域>/<文件>"` 与
// `from "../../<域>/<文件>"` 都算跨域深引，与深度无关；`from "../<域>"` 指向
// 目标域出口的导入是合规形态，不计数。两种深度必须同时覆盖，否则会漏计
// script/words/ 下 9 处深度 2 的深引而假绿。shared 遵循同一「出口 + 实现叶」
// 约定，但不在本判据的域清单里（沿用注册口径）。
const DEEP_IMPORT_PATTERN =
  /from "\.\.\/(\.\.\/)?(chapters|contracts|diagnostics|editing|element|i18n|layout|schema|script)\//;

// 契约层只放类型的判据：export function / export class（含 async / 无前缀形态），
// export type / export const / export interface 不受限。
const TYPE_ONLY_VIOLATION_PATTERN =
  /^(?:export\s+)?(?:async\s+)?(?:function|class)\s/m;

describe("编辑器包结构不变式", () => {
  it("扫描面自检：glob 命中数量与已知文件（防空扫描假绿）", () => {
    expect(SOURCE_KEYS.length).toBeGreaterThanOrEqual(60);
    expect(SOURCE_KEYS).toContain("../../packages/editor/src/index.ts");
    expect(SOURCE_KEYS).toContain("../../packages/editor/src/contracts/index.ts");
  });

  it("契约层只放类型：contracts/** 内 export function / export class = 0", () => {
    expect(SOURCE_KEYS.length).toBeGreaterThanOrEqual(60);
    // 正样本自检 1（管道级）：全包源码里必须能找到已知实现函数（shared/guards.ts
    // 的 isPlainObject），证明 glob → raw → 正则管道真实在读代码。
    const allSources = SOURCE_KEYS.map((key) => EDITOR_SOURCES[key]).join("\n");
    expect(TYPE_ONLY_VIOLATION_PATTERN.test(allSources)).toBe(true);
    // 正样本自检 2（正则级）：合成字面量必须命中、类型导出必须放过，
    // 证明正则没有写反成恒真/恒假。
    expect(TYPE_ONLY_VIOLATION_PATTERN.test("export function f() {}")).toBe(true);
    expect(TYPE_ONLY_VIOLATION_PATTERN.test("export class C {}")).toBe(true);
    expect(TYPE_ONLY_VIOLATION_PATTERN.test("export type T = 1;")).toBe(false);
    expect(TYPE_ONLY_VIOLATION_PATTERN.test("export interface I {}")).toBe(false);

    const contractKeys = SOURCE_KEYS.filter((key) => key.includes("/src/contracts/"));
    expect(contractKeys.length).toBeGreaterThanOrEqual(4);
    expect(contractKeys).toContain("../../packages/editor/src/contracts/index.ts");
    const offenders = contractKeys.filter((key) =>
      TYPE_ONLY_VIOLATION_PATTERN.test(EDITOR_SOURCES[key]),
    );
    expect(offenders).toEqual([]);
  });

  it("包内无跨域深引：两种深度都算，域出口合规不计数", () => {
    expect(SOURCE_KEYS.length).toBeGreaterThanOrEqual(60);
    // 正/负样本自检：正则必须命中两种深度的深引、放过出口形态。
    expect(DEEP_IMPORT_PATTERN.test('from "../schema/opSchemas";')).toBe(true);
    expect(DEEP_IMPORT_PATTERN.test('from "../../schema/opSchemas";')).toBe(true);
    expect(DEEP_IMPORT_PATTERN.test('from "../schema";')).toBe(false);
    expect(DEEP_IMPORT_PATTERN.test('from "../../i18n";')).toBe(false);

    const offenders = SOURCE_KEYS
      .filter((key) => key.includes("/src/"))
      .filter((key) => DEEP_IMPORT_PATTERN.test(EDITOR_SOURCES[key]));
    expect(offenders).toEqual([]);
  });

  it("被拆掉的旧扁平文件不得复活（同名文件优先于目录解析）", () => {
    expect(SOURCE_KEYS.length).toBeGreaterThanOrEqual(60);
    const revivals = SOURCE_KEYS.filter((key) =>
      /\/src\/(script\/expr|schema\/opSchemas)\.ts$/.test(key),
    );
    expect(revivals).toEqual([]);
    // 正样本自检：拆分后的目录出口必须存在（否则空扫描也会恒真）。
    expect(SOURCE_KEYS.some((key) => /\/src\/script\/expr\/index\.ts$/.test(key))).toBe(true);
    expect(SOURCE_KEYS.some((key) => /\/src\/schema\/opSchemas\/index\.ts$/.test(key))).toBe(true);
  });
});
