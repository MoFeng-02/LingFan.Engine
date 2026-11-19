/**
 * label 收集单一事实源 + call 目标收窄（类型域 ≡ 运行期域）。
 *
 * 两件事在这里锚住：
 * - **收集面 ≡ 收窄面**：`LABEL_TARGET_ARGS` 是「哪些词的哪些实参承载列目标」的唯一
 *   声明，与词汇层 `KnownColumnName` 收窄的形参位逐一对应。收集器只按这张表走，
 *   不另起一套词表——表里加一行目标位，收集面同步覆盖，反之亦然。
 * - **call 目标域不宽不窄**：`call` 的形参收窄为「已知列名 ∪ 已知函数名」，恰好等于
 *   运行期 call 先查 func 表、再查 flow 列的目标域。func 名进 `FuncNameRegistry`、
 *   flow 列（含按需补出的 label 列）进 `ColumnNameRegistry`，各归其位；无生成物时
 *   两域都退化 string，合法写法零回归。
 *
 * 类型期判别走真实 tsc 探针（与 scene-register 同法）：登记过的名字可赋值、
 * 未登记名在类型期被拒，靠退出码与诊断文本断言，不靠裸子串。
 * 白盒访问内部收集器/渲染器走相对深引：公共 API 走 @lingfan-engine/*。
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan-engine/stories-build";
import {
  collectFuncNames,
  renderTypegen,
} from "../../packages/stories-build/src/typegen";
import {
  LABEL_TARGET_ARGS,
  collectLabelRefs,
} from "../../packages/stories-build/src/compiler/story-compiler/graph/label-refs.ts";
import type { ModuleRecord } from "../../packages/stories-build/src/compiler/story-compiler/graph/core.ts";

const BASE = fileURLToPath(
  new URL("./.tmp-label-target-registry/", import.meta.url),
);

afterEach(() => {
  rmSync(BASE, { recursive: true, force: true });
});

/** 从生成物里抠出一个接口体里的键（含模式行原文）。 */
function registryKeys(text: string, interfaceName: string): string[] {
  const start = text.indexOf(`interface ${interfaceName} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = text.indexOf("  }", start);
  return text
    .slice(start, end)
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** 造一个只供收集器读的最小模块记录（收集器只用 rel 与 sf）。 */
function moduleOf(rel: string, code: string): ModuleRecord {
  return {
    rel,
    sf: ts.createSourceFile(rel, code, ts.ScriptTarget.Latest, true),
    story: null,
    functions: new Map(),
    bindings: new Map(),
    exports: new Map(),
    imports: [],
    consts: [],
    npmNames: new Set(),
    columnFont: null,
    columnType: null,
    columnKind: null,
    columnBody: null,
    columnBodyProps: null,
    uis: new Map(),
    scenes: new Map(),
  };
}

describe("label 收集单一事实源", () => {
  it("label-collection-single-source：收集词表/目标位 ≡ KnownColumnName 收窄形参位", () => {
    // 唯一声明：jump 第 0 参、navigate 第 0/1 参、option 第 1 参——与词汇层收窄位一致
    expect(LABEL_TARGET_ARGS).toEqual({
      jump: [0],
      navigate: [0, 1],
      option: [1],
    });
    // 收集器按表走：三个词的各目标位字面量都被收到，不多（非目标位）不少
    const code = [
      'jump("a");',
      'navigate("b", "c");',
      'menu("?", [option("t", "d")]);',
      'say("不是目标");',
    ].join("\n");
    const refs = collectLabelRefs(
      new Map([["ch1/start.ts", moduleOf("ch1/start.ts", code)]]),
    );
    expect([...refs.keys()].sort()).toEqual(["a", "b", "c", "d"]);
  });
});

/** 写一份隔离的 tsc 探针工程：生成物 + probe.ts + tsconfig，返回运行器。 */
function typeProbe(
  name: string,
  typegenText: string,
  probeLines: readonly string[],
): { status: number; text: string } {
  const root = join(BASE, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "stories.gen.d.ts"), typegenText);
  writeFileSync(join(root, "probe.ts"), probeLines.join("\n"));
  const tsconfig = join(root, "tsconfig.json");
  writeFileSync(
    tsconfig,
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: "esnext",
          target: "esnext",
          moduleResolution: "bundler",
          allowImportingTsExtensions: true,
        },
        include: ["probe.ts", "stories.gen.d.ts"],
      },
      null,
      2,
    ),
  );
  const tsc = join(
    fileURLToPath(new URL("../..", import.meta.url)),
    "node_modules/typescript/bin/tsc",
  );
  try {
    const text = execFileSync(
      process.execPath,
      [tsc, "--noEmit", "-p", tsconfig],
      { cwd: root, encoding: "utf8", stdio: "pipe" },
    );
    return { status: 0, text };
  } catch (error) {
    const failure = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: failure.status ?? 1,
      text: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

const CALL_PROBE_HEAD = [
  'import { script } from "@lingfan-engine/editor";',
  "const { call } = script;",
  "",
];

describe("call 目标收窄（类型域 ≡ 运行期域）", () => {
  it("call-target-narrowed：func 名与 flow 列类型绿，非法目标类型红", () => {
    const typegen = renderTypegen({
      columns: ["start", "bonus"],
      funcNames: ["greet"],
      schemaKeys: [],
      defineKeys: [],
      declaredNames: [],
      extensionPrefixes: [],
    });
    const result = typeProbe("narrowed", typegen, [
      ...CALL_PROBE_HEAD,
      "// 函数名域（func 表）与列名域（flow 列）都是合法 call 目标",
      'call("greet");',
      'call("bonus");',
      'call("start");',
      "",
      "// 既不是 func 名也不是列名：类型期被拒（下面这行故意错，靠退出码断言）",
      'call("nonexistent");',
      "",
    ]);
    expect(result.text).toContain('"nonexistent"');
    // 注册表真合并进去了（不是接口缺席导致的 TS2304 假红）
    expect(result.text).not.toMatch(/TS2304/);
    expect(result.status).not.toBe(0);
  }, 120_000);

  it("无生成物时两域退化 string：任意 call 目标类型绿（零回归）", () => {
    const typegen = renderTypegen({
      columns: [],
      funcNames: [],
      schemaKeys: [],
      defineKeys: [],
      declaredNames: [],
      extensionPrefixes: [],
    });
    const result = typeProbe("degrade", typegen, [
      ...CALL_PROBE_HEAD,
      "// 空表退化 string：未生成收窄时不拿空表把合法写法判红",
      'call("anything");',
      'call("greet");',
      "",
    ]);
    expect(result.status).toBe(0);
  }, 120_000);

  it("FuncNameRegistry ≡ 产物 func 名（类型面与运行期 func 表同源于编译产物）", async () => {
    const root = join(BASE, "domain-parity");
    const files: Record<string, string> = {
      "src/Stories.src/config.ts":
        'export const folders = ["ch1"];\nexport const start = "start.ts";\n',
      "Resources/project.json": JSON.stringify({
        formatVersion: 1,
        name: "目标域工程",
        entry: "start",
        shell: { orientation: "auto" },
      }),
      "src/Stories.src/ch1/start.ts": [
        'import { script } from "@lingfan-engine/editor";',
        "const { say, func, call, jump } = script;",
        "",
        "export function bonus(): void {",
        '  say("奖励关");',
        "}",
        "",
        "export default function start(): void {",
        '  func("greet", [], [say("你好")]);',
        '  call("greet");',
        '  jump("bonus");',
        "}",
        "",
      ].join("\n"),
    };
    for (const [rel, text] of Object.entries(files)) {
      const path = join(root, rel);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, text);
    }
    await buildStories(root);

    // 读编译产物里的全部列，独立收一遍 func 名（运行期 func 表的内容）
    const columns: { commands?: unknown[] }[] = [];
    const storiesDir = join(root, "Resources/Stories");
    const walk = (dir: string): void => {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, item.name);
        if (item.isDirectory()) {
          walk(path);
          continue;
        }
        if (!item.name.endsWith(".json")) continue;
        const raw = JSON.parse(readFileSync(path, "utf8")) as {
          columns?: { commands?: unknown[] }[];
        };
        columns.push(...(raw.columns ?? []));
      }
    };
    walk(storiesDir);

    const typegen = readFileSync(
      join(root, "src/gen/stories.gen.d.ts"),
      "utf8",
    );
    const funcKeys = registryKeys(typegen, "FuncNameRegistry").map((line) =>
      JSON.parse(line.replace(/: 1;$/, "")),
    );
    // 类型面 func 名域 ≡ 编译产物 func 名（collectFuncNames 与 typegen 同一收集器）
    expect(funcKeys.sort()).toEqual(collectFuncNames(columns));
    expect(funcKeys).toContain("greet");
    // flow 列（含补出的 label 列 bonus）在列名域，不在 func 名域
    const columnKeys = registryKeys(typegen, "ColumnNameRegistry");
    expect(columnKeys).toContain('"bonus": 1;');
    expect(columnKeys).toContain('"start": 1;');
    expect(funcKeys).not.toContain("bonus");
  });
});
