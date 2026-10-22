import * as ts from "typescript";
import { compareOrdinal } from "@lingfan-engine/core";
import { script } from "@lingfan-engine/editor";

export interface CompileDiag {
  file: string;
  line: number;
  col: number;
  message: string;
}

export class DiagBag {
  private readonly items = new Map<string, CompileDiag>();

  add(file: string, sf: ts.SourceFile, node: ts.Node, message: string): void {
    this.addPos(file, sf, node.getStart(sf), message);
  }

  addPos(file: string, sf: ts.SourceFile, pos: number, message: string): void {
    const { line, character } = sf.getLineAndCharacterOfPosition(pos);
    const key = `${file}:${line + 1}:${character + 1}:${message}`;
    this.items.set(key, { file, line: line + 1, col: character + 1, message });
  }

  list(): CompileDiag[] {
    return [...this.items.values()].sort(
      (a, b) =>
        compareOrdinal(a.file, b.file) ||
        a.line - b.line ||
        a.col - b.col ||
        compareOrdinal(a.message, b.message),
    );
  }
}

export type ConstValue = string | number | boolean | null;

export type Binding =
  | { kind: "word"; name: string }
  | { kind: "namespace" }
  | { kind: "function"; file: string; name: string }
  | { kind: "declare"; name: string }
  | { kind: "cell"; guard: string }
  | { kind: "const"; value: ConstValue }
  | { kind: "opaque" }
  | {
      kind: "enum";
      file: string;
      name: string;
      members: ReadonlyMap<string, ConstValue>;
    }
  | { kind: "story"; file: string; name: string };

export interface ModuleRecord {
  rel: string;
  sf: ts.SourceFile;
  story: { name: string; node: ts.FunctionDeclaration } | null;
  functions: Map<string, ts.FunctionDeclaration>;
  bindings: Map<string, Binding>;
  exports: Map<string, Binding>;
  imports: ts.ImportDeclaration[];
  consts: ts.VariableStatement[];
  /** node_modules 值导入的本地名登记（扫描期即收集，是否放行由求值喂入决定） */
  npmNames: Set<string>;
  /** 编译期求值喂入：导出名 → JSON 可序列化值；未被求值的文件 = undefined */
  evaluated?: Readonly<Record<string, unknown>>;
  /** 列级字体声明（`export const columnFont = "<名>"`；仅故事文件合法，null = 未声明） */
  columnFont: { value: string; node: ts.Node } | null;
}

export interface StoryConfig {
  readonly folders: readonly string[];
  readonly start: string;
}

export interface Graph {
  files: Map<string, string>;
  records: Map<string, ModuleRecord>;
  config: StoryConfig;
  configSf: ts.SourceFile;
  coveredStories: string[];
  /** 状态根名（发现自 `export declare const <根名>: StoryState`；无声明回退 "state"） */
  readonly stateRoot: string;
}

export const ROOT_TS_FILES_ALLOWED = new Set(["config.ts"]);
export const GEN_PREFIX = "gen/";

/** 列级字体声明的保留导出名（`export const columnFont = "<名>"`，仅故事文件顶层） */
export const COLUMN_FONT_DECL = "columnFont";

export const WORD_NAMES: ReadonlySet<string> = new Set(
  Object.keys(script).filter(
    (k) => typeof (script as Record<string, unknown>)[k] === "function",
  ),
);

export const DEFAULT_STATE_ROOT = "state";

export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}
