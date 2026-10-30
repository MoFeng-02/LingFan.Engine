import { posix, relative } from "node:path";
import * as ts from "typescript";
import type { PathsConfig } from "../../../../pipeline/tsconfig-paths.ts";
import { expandAlias } from "../../../../pipeline/tsconfig-paths.ts";

/**
 * 别名说明符解析：把工程 `tsconfig.json` 的 `paths` 展开成源根内的模块键。
 *
 * 只服务作者手写的那一行 import——产物里一律写相对路径，宿主零配置也能跑。判定结果分五种：
 * - `module`：命中且是源根内的 `.ts`，`rel` 是相对源根的 posix 模块键，交给图谱层当普通模块连边；
 * - `other`：命中且在源根内，但不是 `.ts`（如 `.vue`）。调用方据此给出「不是 .ts 模块」诊断；
 * - `outside`：命中但文件在源根之外。创作导入只接受源根内的模块，越界 fail-closed，
 *   不静默丢弃；`target` 是绝对路径，调用方若按更宽的沙箱复判（例如宿主源码）不必重新展开；
 * - `missing`：有模式命中但展开出的候选都不存在——作者写错路径；
 * - `unmatched`：没有任何模式命中——说明符根本不是别名，调用方按既有的外部包判定继续。
 *
 * `missing` 与 `unmatched` 必须分开：混成一个「未命中」会让普通的 npm 导入也背上一句
 * 「别名没命中」的误导诊断，而真正的别名笔误又会被当成「不支持外部包」。
 *
 * 存在性探测走 `ts.sys.fileExists`（自带平台语义），候选按 tsc 的补全习惯依次试
 * 「原样 / `.ts` / `.d.ts` / 目录索引」，命中即止。
 */
export interface AliasResolver {
  /** 展开一条非相对说明符；`undefined` = 工程没配 `paths`（调用方退回既有判定） */
  resolveSpecifier(specifier: string): AliasOutcome;
  /**
   * 只定位文件、不判沙箱：返回命中的绝对路径，未命中 ⇒ `undefined`。
   *
   * 用途是沙箱根与源根不同的调用方（UI 文件在 `src/ui/` 而不在 `src/Stories.src/`）：
   * 它们拿到绝对路径后按自己的根折算并判越界，不必让别名解析器猜第二套沙箱。
   */
  locateFile(specifier: string): string | undefined;
}

export type AliasOutcome =
  | { readonly kind: "module"; readonly target: string; readonly rel: string }
  | { readonly kind: "other"; readonly target: string; readonly rel: string }
  | { readonly kind: "outside"; readonly target: string }
  | { readonly kind: "missing" }
  | { readonly kind: "unmatched" };

/** 候选路径的补全形态（tsc 的模块解析习惯：原样 → .ts → .d.ts → 目录索引） */
const PROBES = ["", ".ts", ".d.ts", "/index.ts"] as const;

/**
 * 按工程配置造解析器。`config` 为 `null`（无 tsconfig 或无 paths）⇒ 返回 `undefined`，
 * 让调用方保持「只认相对路径」的既有行为。
 */
export function createAliasResolver(
  config: PathsConfig | null,
  sourcesDir: string,
): AliasResolver | undefined {
  if (config === null) return undefined;
  return {
    resolveSpecifier(specifier): AliasOutcome {
      const candidates = expandAlias(config, specifier);
      if (candidates.length === 0) return { kind: "unmatched" };
      const target = locateIn(candidates);
      if (target === undefined) return { kind: "missing" };
      const rel = insideSources(sourcesDir, target);
      if (rel === null) return { kind: "outside", target };
      return rel.endsWith(".ts")
        ? { kind: "module", target, rel }
        : { kind: "other", target, rel };
    },
    locateFile(specifier): string | undefined {
      return locateIn(expandAlias(config, specifier));
    },
  };
}

/** 按 tsc 的补全习惯逐个候选探测存在性，命中即止 */
function locateIn(candidates: readonly string[]): string | undefined {
  for (const candidate of candidates) {
    for (const probe of PROBES) {
      const target = `${candidate}${probe}`;
      if (ts.sys.fileExists(target)) return target;
    }
  }
  return undefined;
}

/** 绝对路径 → 相对源根的 posix 路径；越出源根 ⇒ `null` */
function insideSources(sourcesDir: string, absolute: string): string | null {
  const rel = posix.normalize(
    relative(sourcesDir, absolute).split("\\").join("/"),
  );
  if (rel === "" || rel.startsWith("..") || posix.isAbsolute(rel)) return null;
  return rel;
}
