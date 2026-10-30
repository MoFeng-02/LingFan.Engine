import * as ts from "typescript";
import { compareOrdinal } from "@lingfan-engine/core";
import type { SceneType } from "@lingfan-engine/core";
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
  | { kind: "story"; file: string; name: string }
  | { kind: "ui"; name: string };

/**
 * 一次 UI 导入在模块记录里留下的痕迹：只有一个名字与一条相对路径。
 *
 * 装配期靠 `name` 写列级 `uis` 声明，`relPath` 只用于生成/审计定位；UI 文件本身
 * 从不进图谱、不读内容——句柄是纯静态事实，运行期怎么挂载不归编译期管。
 */
export interface UiRecord {
  /** UI 名（= 目录名 = 绑定名 = 文件名去扩展名） */
  name: string;
  /** UI 文件相对 `src/` 的 posix 路径（如 `ui/hub/hub.vue`） */
  relPath: string;
  /** 触发这次登记的导入声明（诊断定位用） */
  node: ts.Node;
}

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
  /** 列类型声明（`export const columnType = "ui"`；仅故事文件合法，null = 未声明） */
  columnType: { value: SceneType; node: ts.Node } | null;
  /** UI 导入登记：UI 名 → 记录。UI 文件不进图谱，这里只留名字与路径 */
  uis: Map<string, UiRecord>;
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
/** 生成物目录前缀：权威声明在 `shared/generated-dir.ts`（编译器只是消费方之一） */
export { GEN_PREFIX } from "../../../shared/index.ts";

/** 列级字体声明的保留导出名（`export const columnFont = "<名>"`，仅故事文件顶层） */
export const COLUMN_FONT_DECL = "columnFont";

/** 列类型声明的保留导出名（`export const columnType = "ui"`，仅故事文件顶层） */
export const COLUMN_TYPE_DECL = "columnType";

/**
 * UI 导入可用的文件扩展名（小写比对）。
 *
 * 只出现在 `src/ui/<名>/<名>.<扩展名>` 这一种形态里；扩展名本身不决定「这是不是 UI」——
 * 相对位置同时要落在 UI 目录下。`.ts` 是特例：故事源自己的 `.ts` 也是这个扩展名，
 * 所以 `.ts` 只有路径合上 `ui/<名>/<名>.ts` 且不在故事源树内时才当 UI，其余照常走模块图。
 */
export const UI_EXTENSIONS = [".vue", ".tsx", ".html", ".ts"] as const;

/** 说明符的 UI 扩展名（小写）；不是 UI 扩展名 ⇒ `undefined` */
export function uiExtensionOf(specifier: string): string | undefined {
  const lower = specifier.toLowerCase();
  return UI_EXTENSIONS.find((ext) => lower.endsWith(ext));
}

export const WORD_NAMES: ReadonlySet<string> = new Set(
  Object.keys(script).filter(
    (k) => typeof (script as Record<string, unknown>)[k] === "function",
  ),
);

export const DEFAULT_STATE_ROOT = "state";

export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}
