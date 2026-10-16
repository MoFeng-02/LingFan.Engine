/**
 * 单轮求值：worker 生命周期（超时/错误兜底）与打包/执行结果翻译成诊断。
 */
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { CompilerDiagnostic } from "../../compiler/index.ts";
import type {
  ConstEvalResult,
  DefineCall,
  DefineBad,
  JsonValue,
} from "../contracts.ts";
import { locateExport } from "../diag/index.ts";
import { WORKER_SOURCE } from "./source.ts";

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

export async function evaluateOnce(
  absEntry: string,
  esbuildPath: string,
  timeoutMs: number,
): Promise<ConstEvalResult> {
  const outcome = await runWorkerRound({
    entry: absEntry,
    esbuildPath,
    workDir: path.dirname(absEntry),
    timeoutMs,
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
            message: `编译期求值超时（>${timeoutMs}ms）——模块顶层代码未在时限内完成求值`,
          },
        ],
      };
  }
}

function runWorkerRound(data: {
  entry: string;
  esbuildPath: string;
  workDir: string;
  timeoutMs: number;
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
    const timer = setTimeout(() => finish({ kind: "timeout" }), data.timeoutMs);
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
