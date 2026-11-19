/**
 * contracts 层方向纪律（contracts-no-value-backedge / contracts-no-barrel-forward /
 * dependency-direction-downward / import-cycles-tightened）。
 *
 * 分层铁律：contracts 是最底层（纯声明，零实现依赖），shared 判定函数消费 contracts
 * 类型/常量（单向向下），包根经**正向出口**直接转发 shared——绝不许 contracts 反向
 * 桶转发 shared（那会让「契约层」依赖实现层，形成层环）。
 *
 * 判据直接扫源码（剥注释后匹配 import/export 语句），不牵动运行时：
 * - contracts/index.ts 不得 `export * from "../shared/…"`（删桶转发）。
 * - contracts/ 任何文件不得 import/export shared（值或类型都不行——契约不依赖实现）。
 * - 包根 index.ts 必须有 `export * from "./shared/index.ts"` 正向出口（守卫公共 API 可达）。
 * - shared/guards.ts 向下 import contracts（方向正确）。
 * 文件级环由 import-cycles.test.ts 的 KNOWN_CYCLES=[] 守住（此处不重复 Tarjan）。
 */
import { describe, expect, it } from "vitest";

const CONTRACTS_SOURCES = import.meta.glob(
  "../../packages/core/src/contracts/**/*.ts",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

const CORE_TOP = import.meta.glob("../../packages/core/src/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const SHARED_SOURCES = import.meta.glob("../../packages/core/src/shared/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

function pick(sources: Record<string, string>, suffix: string): string {
  const hit = Object.entries(sources).find(([p]) => p.endsWith(suffix));
  expect(hit, `${suffix} 应存在`).toBeDefined();
  return hit![1];
}

/** 剥注释（避免文档注释里的「shared」字样误报）：块注释 + 行注释 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** import/export … from "…/shared/…"（值或类型皆算依赖） */
const SHARED_DEP =
  /(?:import|export)\b[^;]*?\bfrom\s*["'][^"']*\/shared\/[^"']*["']/g;

describe("contracts 零实现依赖（contracts-no-value-backedge）", () => {
  it("扫描面非空（防假绿）", () => {
    expect(Object.keys(CONTRACTS_SOURCES).length).toBeGreaterThanOrEqual(30);
  });

  it("contracts/ 任何文件都不 import/export shared", () => {
    const offenders: string[] = [];
    for (const [path, raw] of Object.entries(CONTRACTS_SOURCES)) {
      const code = stripComments(raw);
      if (SHARED_DEP.test(code)) offenders.push(path);
      SHARED_DEP.lastIndex = 0;
    }
    expect(offenders).toEqual([]);
  });
});

describe("contracts 无桶转发（contracts-no-barrel-forward）", () => {
  it("contracts/index.ts 不转发 shared（回边已删）", () => {
    const entry = Object.entries(CONTRACTS_SOURCES).find(([p]) =>
      p.endsWith("/contracts/index.ts"),
    );
    expect(entry, "contracts/index.ts 应存在").toBeDefined();
    const code = stripComments(entry![1]);
    expect(code).not.toMatch(/export\s+\*\s+from\s*["'][^"']*\/shared\//);
  });

  it("contracts/index.ts 仍转发自身各域（删回边不误伤契约出口）", () => {
    const entry = Object.entries(CONTRACTS_SOURCES).find(([p]) =>
      p.endsWith("/contracts/index.ts"),
    )!;
    const code = stripComments(entry[1]);
    expect(code).toMatch(/export\s+\*\s+from\s*["']\.\/runtime\/index\.ts["']/);
    expect(code).toMatch(/export\s+\*\s+from\s*["']\.\/save\.ts["']/);
  });
});

describe("依赖方向向下（dependency-direction-downward）", () => {
  it("包根有 shared 正向出口（守卫公共 API 可达的前提）", () => {
    const index = pick(CORE_TOP, "/src/index.ts");
    expect(stripComments(index)).toMatch(
      /export\s+\*\s+from\s*["']\.\/shared\/index\.ts["']/,
    );
  });

  it("shared/guards.ts 向下 import contracts（方向正确，非回边）", () => {
    const guards = pick(SHARED_SOURCES, "/guards.ts");
    expect(stripComments(guards)).toMatch(
      /import\b[^;]*\bfrom\s*["']\.\.\/contracts\//,
    );
  });
});
