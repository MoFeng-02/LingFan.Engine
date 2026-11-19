/**
 * 引擎错误码目录（ENGINE_ERROR_CODES）的单一事实源与覆盖率判据。
 *
 * 这个目录是 `engine.error` 与 Rust 边界错误码的唯一集中声明处。它的价值全在
 * 「声明错了 / 漏了 / 重复了会红」。本文件锁五类不变量：
 *   - 目录自身良构：无重复、形态合法、守卫能收窄已知码而不误收目录外码；
 *   - 单一声明：目录常量 / 类型只在契约 errors.ts 声明，守卫只在 shared/errors.ts
 *     声明（契约层零实现），其余包不得另立第二份；
 *   - 正向覆盖：运行时真实发射的每个引擎码（字面量 fail / code 负载 / 表达式码 /
 *     动态族展开）都在目录里——新增发射点忘登记即红；
 *   - 反向覆盖：目录里没有「死码」——每个码都能被某处发射或是 Rust 边界 / 兜底码；
 *   - 动态族形态：所有模板字符串 fail 的后缀都落在已展开的族内，新增族不展开即红。
 *
 * 源码扫描用打包器 `?raw`（import.meta.glob），手法沿用 capability-version 测试：
 * 扫描面先自检非空，避免「glob 写错 ⇒ 空扫描 ⇒ 恒绿」的假绿形态。
 */
import { describe, expect, it } from "vitest";
import {
  ENGINE_ERROR_CODES,
  isEngineErrorCode,
  type EngineErrorCode,
} from "@lingfan-engine/core";

/** 运行时源码全文（发射点都在 runtime/；本文件在 tests/engine/contracts/，上溯三级） */
const RUNTIME_SOURCES = import.meta.glob(
  "../../../packages/core/src/runtime/**/*.ts",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** 其余包源码：不得另立第二份错误码目录 */
const OTHER_PACKAGE_SOURCES = import.meta.glob(
  "../../../packages/{stories-build,editor,ui,shell,adapters,create}/src/**/*.ts",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** core 包源码：目录 / 类型 / 守卫各自的唯一声明处互锁 */
const CORE_SOURCES = import.meta.glob("../../../packages/core/src/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const ERRORS_FILE = "../../../packages/core/src/contracts/runtime/errors.ts";
const SHARED_ERRORS_FILE = "../../../packages/core/src/shared/errors.ts";
const EXPR_VALUE_FILE = "../../../packages/core/src/runtime/expr/value.ts";

const CATALOG = new Set<string>(ENGINE_ERROR_CODES);

/** 字面量发射：ctx.fail("code", …) 与 code: "code" 负载（跨行 \s 匹配） */
function literalEmittedCodes(): Set<string> {
  const out = new Set<string>();
  for (const text of Object.values(RUNTIME_SOURCES)) {
    for (const m of text.matchAll(/\.fail\(\s*"([a-z][a-z0-9_-]*)"/g)) {
      out.add(m[1]!);
    }
    for (const m of text.matchAll(/\bcode:\s*"([a-z][a-z0-9_-]*)"/g)) {
      out.add(m[1]!);
    }
  }
  return out;
}

/** 表达式码：ExpressionErrorCode 联合的全部成员（经 ctx.fail(e.code) 原样透传） */
function expressionCodes(): Set<string> {
  const text = RUNTIME_SOURCES[EXPR_VALUE_FILE];
  expect(text, "表达式值模型源码必须在扫描面里").toBeTypeOf("string");
  const block = /export type ExpressionErrorCode =([\s\S]*?);/.exec(text!);
  expect(block, "ExpressionErrorCode 声明必须可提取").not.toBeNull();
  const out = new Set<string>();
  for (const m of block![1]!.matchAll(/"([a-z][a-z0-9_-]*)"/g)) {
    out.add(m[1]!);
  }
  return out;
}

/**
 * 动态族展开表：`<op>-<后缀>` 的具体组合。op 集按分发路由与各 op 族字段表钉死；
 * 这是测试对「哪些 op 会发射哪个族」的预期声明（新增 op / 族须同步此表与目录）。
 */
const DYNAMIC_FAMILIES: ReadonlyArray<{
  suffix: string;
  ops: readonly string[];
}> = [
  { suffix: "-outside-loop", ops: ["break", "continue"] },
  {
    suffix: "-unknown-field",
    ops: [
      "wait",
      "pause",
      "bgm",
      "se",
      "ambient",
      "voice",
      "stop_bgm",
      "stop_ambient",
      "stop_voice",
      "stop_se",
      "audio_pause",
      "audio_resume",
      "audio_play",
      "audio_stop",
      "audio_volume",
      "audio_seek",
      "video",
      "cutscene",
      "seek_video",
      "pause_video",
      "resume_video",
      "stop_video",
      "video_skipable",
      "show",
      "hide",
      "background",
      "bg_switch",
      "zindex",
      "style",
      "block_rollback",
      "fix_rollback",
    ],
  },
  { suffix: "-target-not-found", ops: ["animate", "animate_block"] },
  { suffix: "-invalid", ops: ["background", "bg_switch"] },
  {
    suffix: "-invalid-resource",
    ops: ["bgm", "se", "ambient", "voice", "video", "cutscene"],
  },
  {
    suffix: "-invalid-channel",
    ops: ["audio_pause", "audio_resume", "audio_volume", "audio_seek"],
  },
  {
    suffix: "-target-conflict",
    ops: ["audio_pause", "audio_resume", "audio_volume", "audio_seek"],
  },
  {
    suffix: "-invalid-instance",
    ops: ["audio_pause", "audio_resume", "audio_seek", "audio_volume"],
  },
  {
    suffix: "-unknown-instance",
    ops: ["audio_pause", "audio_resume", "audio_seek"],
  },
  {
    suffix: "-invalid-volume",
    ops: [
      "bgm",
      "se",
      "ambient",
      "voice",
      "audio_play",
      "audio_volume",
      "video",
      "cutscene",
    ],
  },
  {
    suffix: "-invalid-fade",
    ops: [
      "bgm",
      "se",
      "ambient",
      "voice",
      "stop_bgm",
      "stop_ambient",
      "stop_voice",
      "stop_se",
      "audio_play",
      "audio_stop",
    ],
  },
  { suffix: "-invalid-seconds", ops: ["audio_seek", "seek_video"] },
  { suffix: "-missing-target", ops: ["audio_volume", "audio_seek"] },
];

function dynamicCodes(): Set<string> {
  const out = new Set<string>();
  for (const { suffix, ops } of DYNAMIC_FAMILIES) {
    for (const op of ops) out.add(`${op}${suffix}`);
  }
  return out;
}

/** Rust 命令边界码（各适配器枚举 serde(tag="code") 的 code 值）+ 兜底码 */
const RUST_BOUNDARY_CODES: readonly string[] = [
  "app-data",
  "bad-delete",
  "bad-format",
  "bad-json",
  "bad-manifest",
  "bad-mode",
  "bad-path",
  "crypto",
  "decrypt",
  "invalid-path",
  "invalid-slot",
  "io",
  "keyring",
  "missing-key",
  "missing-manifest",
  "missing-stories",
  "mobile-asset",
  "native",
  "resource-dir",
  "rollback-detected",
  "root",
  "too-large",
  "unknown-slot",
  "watch",
  "watch-dev-only",
];
const FALLBACK_CODE = "rust-command-failed";

describe("错误码目录 · 良构与守卫", () => {
  it("扫描面非空（防 glob 写错导致的恒绿）", () => {
    expect(Object.keys(RUNTIME_SOURCES).length).toBeGreaterThan(30);
    expect(Object.keys(OTHER_PACKAGE_SOURCES).length).toBeGreaterThan(30);
    expect(RUNTIME_SOURCES[ERRORS_FILE]).toBeUndefined(); // errors.ts 在 contracts，不在 runtime 扫描面
  });

  it("目录非空、无重复、形态合法（小写字母数字 / _ / -）", () => {
    expect(ENGINE_ERROR_CODES.length).toBeGreaterThan(100);
    expect(CATALOG.size).toBe(ENGINE_ERROR_CODES.length); // 无重复
    for (const code of ENGINE_ERROR_CODES) {
      expect(code, `错误码形态非法：${code}`).toMatch(/^[a-z][a-z0-9_-]*$/);
    }
  });

  it("守卫收窄每个已知码；目录外字符串 / 非字符串一律 false", () => {
    for (const code of ENGINE_ERROR_CODES) {
      expect(isEngineErrorCode(code), `${code} 应被守卫识别`).toBe(true);
    }
    // 扩展宿主自有码不在目录内——守卫不误收，调用方据此走兜底
    expect(isEngineErrorCode("my-extension-own-code")).toBe(false);
    expect(isEngineErrorCode("")).toBe(false);
    expect(isEngineErrorCode("UNKNOWN-CODE")).toBe(false);
    expect(isEngineErrorCode(42)).toBe(false);
    expect(isEngineErrorCode(null)).toBe(false);
    expect(isEngineErrorCode(undefined)).toBe(false);
    expect(isEngineErrorCode({ code: "io" })).toBe(false);
  });

  it("类型收窄可用（EngineErrorCode 赋值得到守卫背书的字面量）", () => {
    const code: EngineErrorCode = "unknown-op";
    expect(isEngineErrorCode(code)).toBe(true);
  });
});

describe("错误码目录 · 单一声明（error-code-union-single-source）", () => {
  it("目录常量 / 类型只在契约 errors.ts；守卫只在 shared/errors.ts", () => {
    const owners = (decl: string) =>
      Object.entries(CORE_SOURCES)
        .filter(([, text]) => text.includes(decl))
        .map(([path]) => path);
    expect(owners("const ENGINE_ERROR_CODES")).toEqual([ERRORS_FILE]);
    expect(owners("export type EngineErrorCode")).toEqual([ERRORS_FILE]);
    expect(owners("function isEngineErrorCode")).toEqual([SHARED_ERRORS_FILE]);
  });

  it("契约层零实现：contracts 源码不出现 function 关键字", () => {
    const contracts = Object.entries(CORE_SOURCES).filter(([path]) =>
      path.includes("/contracts/"),
    );
    expect(contracts.length).toBeGreaterThan(0);
    for (const [path, text] of contracts) {
      // 字符串字面量是数据不是实现（如错误码 "unknown-function"），剥除后再扫描
      const stripped = text.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '""');
      expect(stripped, path).not.toMatch(/\bfunction\b/);
    }
  });

  it("目录常量 / 类型 / 守卫在其余包零命中", () => {
    const declarations = [
      "const ENGINE_ERROR_CODES",
      "type EngineErrorCode",
      "function isEngineErrorCode",
    ];
    for (const decl of declarations) {
      const hits = Object.entries(OTHER_PACKAGE_SOURCES)
        .filter(([, text]) => text.includes(decl))
        .map(([path]) => path);
      expect(hits, `「${decl}」在其余包被二次声明`).toEqual([]);
    }
  });
});

describe("错误码目录 · 正向覆盖（发射的码都在目录里）", () => {
  it("字面量 fail / code 负载发射的每个码都在目录里", () => {
    const emitted = literalEmittedCodes();
    expect(emitted.size, "字面量发射扫描不得为空").toBeGreaterThan(50);
    const missing = [...emitted].filter((c) => !CATALOG.has(c));
    expect(missing, "这些发射码未登记进目录").toEqual([]);
  });

  it("表达式码全集都在目录里", () => {
    const expr = expressionCodes();
    expect(expr.size).toBe(8);
    const missing = [...expr].filter((c) => !CATALOG.has(c));
    expect(missing, "表达式码未登记进目录").toEqual([]);
  });

  it("动态族展开的每个码都在目录里", () => {
    const dyn = dynamicCodes();
    expect(dyn.size).toBeGreaterThan(60);
    const missing = [...dyn].filter((c) => !CATALOG.has(c));
    expect(missing, "动态族码未登记进目录").toEqual([]);
  });

  it("Rust 边界码与兜底码都在目录里", () => {
    for (const code of [...RUST_BOUNDARY_CODES, FALLBACK_CODE]) {
      expect(CATALOG.has(code), `边界码 ${code} 未登记`).toBe(true);
    }
  });
});

describe("错误码目录 · 反向覆盖（目录里没有死码）", () => {
  it("每个目录码都能被发射或是边界 / 兜底码", () => {
    const justified = new Set<string>([
      ...literalEmittedCodes(),
      ...expressionCodes(),
      ...dynamicCodes(),
      ...RUST_BOUNDARY_CODES,
      FALLBACK_CODE,
    ]);
    const dead = ENGINE_ERROR_CODES.filter((c) => !justified.has(c));
    expect(dead, "这些目录码没有任何发射来源（死码）").toEqual([]);
  });
});

describe("错误码目录 · 动态族形态（新增族不展开即红）", () => {
  it("所有模板字符串 fail 的后缀都落在已展开的族内", () => {
    const knownSuffixes = new Set(DYNAMIC_FAMILIES.map((f) => f.suffix));
    const seen = new Set<string>();
    for (const text of Object.values(RUNTIME_SOURCES)) {
      for (const m of text.matchAll(/\.fail\(\s*`([^`]+)`/g)) {
        const tpl = m[1]!;
        const suffix = tpl.slice(tpl.indexOf("}") + 1);
        seen.add(suffix);
      }
    }
    expect(seen.size, "动态族扫描不得为空").toBeGreaterThan(5);
    const unhandled = [...seen].filter((s) => !knownSuffixes.has(s));
    expect(unhandled, "这些动态族后缀未在展开表里登记").toEqual([]);
  });
});
