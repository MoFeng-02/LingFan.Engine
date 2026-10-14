/**
 * 编译期求值器（const-eval）：把 Stories.src 模块的模块层 const 初始化链求值成
 * JSON 可序列化值，供 story-compiler 后续接入（const 内联 / staticFor 展开等）。
 *
 * 管线（每轮一遍，共两轮）：
 * 1. esbuild 把入口模块的依赖链（含 node_modules 包）打包为内存 bundle（不落盘）；
 * 2. 在隔离 worker（node worker_threads）中执行 bundle，取导出常量值；
 * 3. 导出分类：仅接受 JSON 可序列化值；函数 / undefined / symbol / bigint / NaN /
 *    非普通对象（Date/Map/Set/class 实例）等一律报诊断。
 * 4. 构建期内建注入：`define` / `defineVars` 以求值环境实参进 factory（无运行时实体）——
 *    define 调用按书写序累积成 DefineCall 序列（形态 B），defineVars 返回实参本身
 *    （`export const vars = defineVars({...})` 的导出值 = 键集对象，即 config.vars 键来源）。
 *
 * 确定性闸门（fail-closed）：同一 entry 求值两次，逐键 deepEqual；不一致即报错，
 * 文案指明禁 Date / Math.random / IO 等不确定源。
 *
 * 硬性约束：
 * - 求值只执行模块顶层代码；导出的函数体（含故事默认导出函数体）从不被调用；
 * - esbuild 打包与求值都在 worker 内完成，主进程不被模块顶层代码污染；
 * - 本模块不修改 build/ 下其他既有文件，也不修改 packages/ 任何代码。
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { CompilerDiagnostic } from "../compiler";

/** JSON 可序列化值（求值产物的唯一合法形态）。 */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** 求值结果：要么拿到全部导出常量的可序列化值，要么拿到一组诊断（fail-closed）。 */
export type ConstEvalResult =
  | { values: Record<string, JsonValue>; defineCalls: readonly DefineCall[] }
  | { diags: CompilerDiagnostic[] };

/**
 * define() 构建期内建的调用记录（形态 B 累积；书写序即合并序）：
 * - `path`：`define("a.b", value)` 点路径单值声明；
 * - `spec`：`define({...})` 对象字面量子树声明。
 * 值在 worker 内已过 classify（JSON 安全）；非法值不进此表（走 defineBad 诊断）。
 */
export type DefineCall =
  | { kind: "path"; path: string; value: JsonValue }
  | { kind: "spec"; spec: Record<string, JsonValue> };

/** define() 非法调用的记录（求值段把每条翻成诊断，统一挂入口 1:1）。 */
export interface DefineBad {
  readonly path: string;
  readonly reason: string;
}

/** 单轮求值超时（模块顶层死循环不应拖死构建）。 */
const EVAL_TIMEOUT_MS = 30_000;

/**
 * 求值入口：`entry` = Stories.src 内源文件绝对路径。
 * 返回该模块全部导出常量的 JSON 可序列化值；任何不可序列化导出、打包失败、
 * 顶层执行抛错、求值超时或两次求值不一致，都返回诊断集（fail-closed）。
 */
export async function evalConstModule(entry: string): Promise<ConstEvalResult> {
  const absEntry = path.resolve(entry);
  const esbuildPath = resolveEsbuildPath();
  if (esbuildPath === null) {
    return {
      diags: [
        {
          file: absEntry,
          line: 1,
          col: 1,
          message:
            "esbuild 未解析到——@lingfan/stories-build 依赖 esbuild 完成依赖链打包，" +
            "请确认该依赖已装好（本包从自身位置解析 esbuild，不借用调用方工程的 node_modules）",
        },
      ],
    };
  }

  const evaluateRound = (): Promise<ConstEvalResult> =>
    evaluateOnce(absEntry, esbuildPath);

  const first = await evaluateRound();
  if ("diags" in first) return first;
  const second = await evaluateRound();
  if ("diags" in second) return second;

  const differingKey = firstDeterminismDiff(first.values, second.values);
  if (differingKey !== null) {
    return {
      diags: [
        {
          file: absEntry,
          line: 1,
          col: 1,
          message:
            `编译期求值不确定：导出 "${differingKey}" 在两次求值间不一致 —— ` +
            "模块层 const 必须确定性求值：禁用 Date（new Date()/Date.now()）、Math.random、文件/网络 IO 等不确定源",
        },
      ],
    };
  }
  if (!deepEqual(first.defineCalls, second.defineCalls)) {
    return {
      diags: [
        {
          file: absEntry,
          line: 1,
          col: 1,
          message:
            "编译期求值不确定：define() 声明在两次求值间不一致 —— " +
            "模块顶层代码必须确定性求值：禁用 Date（new Date()/Date.now()）、Math.random、文件/网络 IO 等不确定源",
        },
      ],
    };
  }
  return { values: first.values, defineCalls: first.defineCalls };
}

function resolveEsbuildPath(): string | null {
  try {
    return createRequire(import.meta.url).resolve("esbuild");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// worker 轮次：打包 + 执行 + 导出分类
// ---------------------------------------------------------------------------

interface WorkerExportsMessage {
  kind: "exports";
  values: Record<string, unknown>;
  bad: { key: string; reason: string }[];
  defineCalls: DefineCall[];
  defineBad: DefineBad[];
}
interface WorkerEsbuildMessage {
  kind: "esbuild-error";
  diags: CompilerDiagnostic[];
}
interface WorkerRuntimeMessage {
  kind: "runtime-error";
  message: string;
}
type WorkerOutcome =
  | WorkerExportsMessage
  | WorkerEsbuildMessage
  | WorkerRuntimeMessage
  | { kind: "timeout" };

async function evaluateOnce(
  absEntry: string,
  esbuildPath: string,
): Promise<ConstEvalResult> {
  const outcome = await runWorkerRound({
    entry: absEntry,
    esbuildPath,
    workDir: path.dirname(absEntry),
  });

  switch (outcome.kind) {
    case "exports": {
      if (outcome.bad.length > 0) {
        return {
          diags: outcome.bad.map((item) => {
            const at = locateExport(absEntry, item.key);
            return {
              file: absEntry,
              line: at.line,
              col: at.col,
              message: `导出 "${item.key}" 非 JSON 可序列化（${item.reason}）——编译期求值产物仅取 JSON 可序列化值`,
            };
          }),
        };
      }
      if (outcome.defineBad.length > 0) {
        return {
          diags: outcome.defineBad.map((item) => ({
            file: absEntry,
            line: 1,
            col: 1,
            message: `define("${item.path}")：${item.reason}——define 值文法与 state 同规（仅 JSON 可序列化值；函数/undefined/symbol/bigint 拒）`,
          })),
        };
      }
      // worker 分类已保证 JSON 安全，边界处收窄类型
      return {
        values: outcome.values as Record<string, JsonValue>,
        defineCalls: outcome.defineCalls,
      };
    }
    case "esbuild-error":
      return { diags: outcome.diags };
    case "runtime-error":
      return {
        diags: [
          {
            file: absEntry,
            line: 1,
            col: 1,
            message: `编译期求值失败：模块顶层执行抛错 —— ${outcome.message}`,
          },
        ],
      };
    case "timeout":
      return {
        diags: [
          {
            file: absEntry,
            line: 1,
            col: 1,
            message: `编译期求值超时（>${EVAL_TIMEOUT_MS}ms）——模块顶层代码未在时限内完成求值`,
          },
        ],
      };
  }
}

function runWorkerRound(data: {
  entry: string;
  esbuildPath: string;
  workDir: string;
}): Promise<WorkerOutcome> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: data });
    let settled = false;
    const finish = (outcome: WorkerOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(outcome);
    };
    const timer = setTimeout(
      () => finish({ kind: "timeout" }),
      EVAL_TIMEOUT_MS,
    );
    worker.on("message", (message: { kind?: unknown }) => {
      if (
        message !== null &&
        typeof message === "object" &&
        typeof message.kind === "string"
      ) {
        finish(message as WorkerOutcome);
      } else {
        finish({ kind: "runtime-error", message: "worker 返回了未知消息形态" });
      }
    });
    worker.on("error", (error: unknown) => {
      finish({
        kind: "runtime-error",
        message: error instanceof Error ? error.message : String(error),
      });
    });
    worker.on("exit", (code: number) => {
      if (!settled)
        finish({
          kind: "runtime-error",
          message: `worker 异常退出（exit code ${code}）`,
        });
    });
  });
}

/**
 * worker 源码（eval 模式注入，避免新增文件）：
 * esbuild 打包入口依赖链为内存 CJS bundle → 以 CJS 包装执行（require 透传 node 内建与
 * node_modules）→ 逐导出分类（JSON 安全 / 记录不可序列化原因）→ postMessage 回主线程。
 * 注意：worker 代码是模板字符串，内部不得使用反引号与 ${}。
 */
const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const { createRequire } = require("node:module");
const path = require("node:path");

/** 返回 null = JSON 可序列化；否则返回不可序列化原因。 */
function classify(value, seen) {
  if (value === undefined) return "undefined";
  if (value === null || typeof value === "string" || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? null : "非有限数值（NaN/Infinity）";
  if (typeof value === "function") return "函数（function）";
  if (typeof value === "bigint") return "bigint";
  if (typeof value === "symbol") return "symbol";
  if (typeof value !== "object") return "不可序列化类型（" + String(typeof value) + "）";
  if (seen.has(value)) return "循环引用";
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (!(i in value)) return "数组空洞（undefined 元素）";
        const element = classify(value[i], seen);
        if (element !== null) return element;
      }
      return null;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      const name = (proto.constructor && proto.constructor.name) || "unknown";
      return "非普通对象（" + name + " 实例：Date/Map/Set/class 等不保证可序列化）";
    }
    for (const key of Object.keys(value)) {
      const member = classify(value[key], seen);
      if (member !== null) return member;
    }
    return null;
  } finally {
    seen.delete(value);
  }
}

(async () => {
  try {
    const requireEsbuild = createRequire(workerData.esbuildPath);
    const esbuild = requireEsbuild(workerData.esbuildPath);
    const result = await esbuild.build({
      entryPoints: [workerData.entry],
      bundle: true,
      write: false,
      format: "cjs",
      platform: "node",
      logLevel: "silent",
      absWorkingDir: workerData.workDir,
    });
    const code = result.outputFiles[0].text;

    const moduleObj = { exports: {} };
    const runRequire = createRequire(workerData.entry);

    // define / defineVars：config.ts 构建期内建（求值环境注入，无运行时实体）。
    // define 二态：字符串首参 = 点路径单值；普通对象首参 = 子树声明；值过 classify
    // 才入列（非法值进 defineBad，由求值段翻成诊断）。defineVars 返回实参本身，
    // 使 export const vars = defineVars({...}) 的导出值 = 键集对象（vars 键来源）。
    const defineCalls = [];
    const defineBad = [];
    function define(pathOrSpec, value) {
      if (typeof pathOrSpec === "string") {
        const reason = classify(value, new Set());
        if (reason !== null) {
          defineBad.push({ path: pathOrSpec, reason: "值不可序列化（" + reason + "）" });
          return;
        }
        defineCalls.push({ kind: "path", path: pathOrSpec, value: value });
        return;
      }
      if (pathOrSpec !== null && typeof pathOrSpec === "object" && !Array.isArray(pathOrSpec)) {
        const reason = classify(pathOrSpec, new Set());
        if (reason !== null) {
          defineBad.push({ path: "(对象实参)", reason: "对象实参不可序列化（" + reason + "）" });
          return;
        }
        defineCalls.push({ kind: "spec", spec: pathOrSpec });
        return;
      }
      defineBad.push({ path: "(实参)", reason: "首参须为点路径字符串或对象字面量" });
    }
    function defineVars(spec) {
      return spec;
    }

    const factory = new Function(
      "module",
      "exports",
      "require",
      "__filename",
      "__dirname",
      "define",
      "defineVars",
      code,
    );
    factory(moduleObj, moduleObj.exports, runRequire, workerData.entry, path.dirname(workerData.entry), define, defineVars);
    try { delete moduleObj.exports.__esModule; } catch { /* 不可删则忽略 */ }

    const values = {};
    const bad = [];
    for (const key of Object.keys(moduleObj.exports)) {
      const reason = classify(moduleObj.exports[key], new Set());
      if (reason === null) values[key] = moduleObj.exports[key];
      else bad.push({ key, reason });
    }
    parentPort.postMessage({ kind: "exports", values, bad, defineCalls, defineBad });
  } catch (error) {
    if (error !== null && typeof error === "object" && Array.isArray(error.errors)) {
      const diags = error.errors.map((item) => {
        const at = item.location ?? null;
        return {
          file: (at && at.file) || workerData.entry,
          line: (at && at.line) || 1,
          col: ((at && at.column) ?? 0) + 1,
          message: item.text ?? String(item),
        };
      });
      parentPort.postMessage({ kind: "esbuild-error", diags });
      return;
    }
    parentPort.postMessage({
      kind: "runtime-error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
})();
`;

// ---------------------------------------------------------------------------
// 主线程辅助：诊断定位与逐键比较
// ---------------------------------------------------------------------------

/** 在入口源文件里定位 `export <key>` 声明（1 基 line/col）；找不到退回 1:1。 */
function locateExport(
  absEntry: string,
  key: string,
): { line: number; col: number } {
  let text: string;
  try {
    text = readFileSync(absEntry, "utf8");
  } catch {
    return { line: 1, col: 1 };
  }
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns =
    key === "default"
      ? [/(^|\n)[ \t]*export[ \t]+default\b/]
      : [
          new RegExp(
            `(^|\\n)[ \\t]*export[ \t]+(?:const|let|var|async[ \t]+function|function|class)[ \t]+${escaped}\\b`,
          ),
          new RegExp(
            `(^|\\n)[ \\t]*export[ \t]*\\{[^}]*\\b${escaped}\\b[^}]*\\}`,
          ),
        ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match !== null) return offsetToPos(text, match.index + match[1].length);
  }
  return { line: 1, col: 1 };
}

function offsetToPos(
  text: string,
  offset: number,
): { line: number; col: number } {
  const lines = text.slice(0, offset).split("\n");
  return {
    line: lines.length,
    col: (lines[lines.length - 1] ?? "").length + 1,
  };
}

function firstDeterminismDiff(
  a: Record<string, JsonValue>,
  b: Record<string, JsonValue>,
): string | null {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!deepEqual(a[key], b[key])) return key;
  }
  return null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(
      (key) =>
        key in b &&
        deepEqual(
          (a as { [k: string]: JsonValue })[key],
          (b as { [k: string]: JsonValue })[key],
        ),
    );
  }
  return false;
}
