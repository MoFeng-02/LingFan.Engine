import * as ts from "typescript";
import { script } from "@lingfan/editor";

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
        a.file.localeCompare(b.file) ||
        a.line - b.line ||
        a.col - b.col ||
        a.message.localeCompare(b.message),
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
  | { kind: "enum"; file: string; name: string; members: ReadonlyMap<string, ConstValue> }
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
  /** node_modules 值导入的本地名登记（C10；扫描期即收集，是否放行由求值喂入决定） */
  npmNames: Set<string>;
  /** 编译期求值喂入（对应章节）：导出名 → JSON 可序列化值；未被求值的文件 = undefined */
  evaluated?: Readonly<Record<string, unknown>>;
  /**
   * `defineVars({...})` 清单里的变量键（扫描期收集，不折叠值）。
   *
   * 变量句柄是纯类型面的东西：`defineVars` 只登记键名与类型标签，键在插值里合法，
   * 但可能从不出现在任何 op 流中（只写 `say("…{player.hp}…")` 而不 set 它）。
   * 因此类型面生成器必须单独拿到这份清单——产物列集与 state schema 都推不出来。
   */
  defineVarsKeys: Set<string>;
}

export interface StoryConfig {
  folders: string[];
  start: string;
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

export const WORD_NAMES: ReadonlySet<string> = new Set(
  Object.keys(script).filter((k) => typeof (script as Record<string, unknown>)[k] === "function"),
);

export const DEFAULT_STATE_ROOT = "state";

export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}
