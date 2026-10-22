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
 *
 * 分文件：共享契约 `./contracts.ts`；worker 轮次 `./round/`；诊断辅助 `./diag/`。
 */
import { createRequire } from "node:module";
import path from "node:path";
import type { ConstEvalResult } from "./contracts.ts";
import { deepEqual, firstDeterminismDiff } from "./diag/index.ts";
import { evaluateOnce } from "./round/index.ts";

/** 契约类型仍从本文件转出（同域兄弟模块按 `./const-eval.ts` 取件，取件面不变）。 */
export type {
  ConstEvalResult,
  DefineCall,
  DefineBad,
  JsonValue,
} from "./contracts.ts";

/** 单轮求值超时缺省值（毫秒；模块顶层死循环不应拖死构建）。 */
export const DEFAULT_EVAL_TIMEOUT_MS = 30_000;

/**
 * 求值入口：`entry` = Stories.src 内源文件绝对路径。
 * `timeoutMs` = 单轮求值时限（缺省 30_000；编排入口 evalTimeoutMs 逐层透传至此）。
 * 返回该模块全部导出常量的 JSON 可序列化值；任何不可序列化导出、打包失败、
 * 顶层执行抛错、求值超时或两次求值不一致，都返回诊断集（fail-closed）。
 */
export async function evalConstModule(
  entry: string,
  timeoutMs: number = DEFAULT_EVAL_TIMEOUT_MS,
): Promise<ConstEvalResult> {
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
            "esbuild 未解析到——@lingfan-engine/stories-build 依赖 esbuild 完成依赖链打包，" +
            "请确认该依赖已装好（本包从自身位置解析 esbuild，不借用调用方工程的 node_modules）",
        },
      ],
    };
  }

  const evaluateRound = (): Promise<ConstEvalResult> =>
    evaluateOnce(absEntry, esbuildPath, timeoutMs);

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
