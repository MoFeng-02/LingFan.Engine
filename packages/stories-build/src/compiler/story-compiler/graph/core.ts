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

/**
 * 列种类：`scene`（身体由组件承载）或 `flow`（命令体承载）。
 *
 * 缺省即 `flow`——绝大多数列都不必声明，只有组件化的房间才写
 * `export const columnKind = "scene"`。
 */
export type ColumnKind = "scene" | "flow";

/** JSON 安全值：进 `SYS.body` 的 props 必须是这个形状，引擎不求值 */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** JSON 安全对象（`bodyProps` 折叠后的落账形状） */
export type JsonObject = { [key: string]: JsonValue };

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
  | { kind: "ui"; name: string }
  | { kind: "scene"; name: string };

/**
 * 一次组件导入在模块记录里留下的痕迹：只有一个名字与一条相对路径。
 *
 * 叠加层组件（`ui`）与列身体组件（`scenes`）共用这个形状：两者都是「名字 = 目录名」
 * 的静态事实，文件本身从不进图谱、不读内容——运行期怎么渲染不归编译期管。
 */
export interface ComponentRecord {
  /** 组件名（= 目录名 = 绑定名 = 文件名去扩展名） */
  name: string;
  /** 组件文件相对 `src/` 的 posix 路径（如 `ui/hub/hub.vue`） */
  relPath: string;
  /** 触发这次登记的导入声明（诊断定位用） */
  node: ts.Node;
}

/** 一个 UI 导入的落账（形状与其余组件一致） */
export type UiRecord = ComponentRecord;

/** 一个场景（列身体）导入的落账（形状与其余组件一致） */
export type SceneRecord = ComponentRecord;

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
  /** 列种类声明（`export const columnKind = "scene"`；null = 未声明，等价 flow） */
  columnKind: { value: ColumnKind; node: ts.Node } | null;
  /** 列身体组件声明（`export const body = kitchen`；null = 未声明） */
  columnBody: { value: string; node: ts.Node } | null;
  /** 列身体 props（`export const bodyProps = {…}`；null = 未声明） */
  columnBodyProps: { value: JsonObject; node: ts.Node } | null;
  /** UI 导入登记：UI 名 → 记录。UI 文件不进图谱，这里只留名字与路径 */
  uis: Map<string, UiRecord>;
  /** 场景（列身体）导入登记：形状与 `uis` 一致，两张表互不合并 */
  scenes: Map<string, SceneRecord>;
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
 * 列种类声明的保留导出名（`export const columnKind = "scene"`，仅故事文件顶层）。
 *
 * 缺省即 `flow`，所以绝大多数列不必写它；写了 `scene` 就必须同时给 `body`。
 */
export const COLUMN_KIND_DECL = "columnKind";

/**
 * 列身体声明的保留导出名（`export const body = kitchen`，仅故事文件顶层）。
 *
 * 值是**具名导入的组件句柄**，不是文件路径字符串——句柄与 `import kitchen from
 * "../scenes/kitchen/kitchen.vue"` 折叠出同一个名字，两边共用一个判定。
 */
export const COLUMN_BODY_DECL = "body";

/**
 * 列身体 props 的保留导出名（`export const bodyProps = { … }`，仅故事文件顶层）。
 *
 * 必须是静态对象字面量：值是 JSON 安全的，引擎原样写进 `SYS.body`，运行期不求值。
 */
export const COLUMN_BODY_PROPS_DECL = "bodyProps";

/**
 * UI 导入可用的文件扩展名（小写比对）。
 *
 * 只出现在 `src/ui/<名>/<名>.<扩展名>` 这一种形态里；扩展名本身不决定「这是不是 UI」——
 * 相对位置同时要落在 UI 目录下。`.ts` 是特例：故事源自己的 `.ts` 也是这个扩展名，
 * 所以 `.ts` 只有路径合上 `ui/<名>/<名>.ts` 且不在故事源树内时才当 UI，其余照常走模块图。
 */
export const UI_EXTENSIONS = [".vue", ".tsx", ".ts"] as const;

/** 说明符的 UI 扩展名（小写）；不是 UI 扩展名 ⇒ `undefined` */
export function uiExtensionOf(specifier: string): string | undefined {
  const lower = specifier.toLowerCase();
  return UI_EXTENSIONS.find((ext) => lower.endsWith(ext));
}

/** UI 根目录名（源根的兄弟目录，与故事源平级） */
export const UI_DIR_NAME = "ui";

/** 场景（列身体）根目录名（源根的兄弟目录，与故事源平级） */
export const SCENE_DIR_NAME = "scenes";

/**
 * 场景注册表生成物的基名（不带扩展名）：生成物是 `<生成物目录>/<基名>.ts`，
 * 故事源以**命名导入**从 `../../gen/scene_register.g` 取句柄（形如 `{ kitchen }`）。
 *
 * 与 UI 注册表分属两份生成物、两张表——合并会让挂载面与身体面互相串号。
 */
export const SCENE_REGISTER_BASENAME = "scene_register.g";

/**
 * UI 注册表生成物的基名（不带扩展名）：生成物是 `<生成物目录>/<基名>.ts`，
 * 故事源以**命名导入**从 `../../gen/ui_register.g` 取句柄（形如 `{ hub }`）。
 *
 * 它没有 UI 扩展名，因此不走 `uiExtensionOf` 那条判定——由 UI 通道单独认这一条形状。
 */
export const UI_REGISTER_BASENAME = "ui_register.g";

/**
 * 组件注册表条目：一个组件的名字与它的实现文件名。
 *
 * 声明在这里而不是注册表实现里，是因为图谱层（组件通道）也要消费它，而
 * 注册表实现反过来依赖本文件的 `UI_EXTENSIONS`——放实现里会成环。
 *
 * `ui` 与 `scenes` 两张表条目同形，分量只在表本身（谁在哪个目录里）。
 */
export interface ComponentRegistryEntry {
  /** 组件名（= 目录名 = 文件名去扩展名） */
  readonly name: string;
  /** 实现文件名（含扩展名，如 `hub.vue`） */
  readonly file: string;
}

/** 一个 UI 的注册表条目（形状与其余组件一致） */
export type UiRegistryEntry = ComponentRegistryEntry;

/** 一个场景（列身体）的注册表条目（形状与其余组件一致） */
export type SceneRegistryEntry = ComponentRegistryEntry;

export const WORD_NAMES: ReadonlySet<string> = new Set(
  Object.keys(script).filter(
    (k) => typeof (script as Record<string, unknown>)[k] === "function",
  ),
);

export const DEFAULT_STATE_ROOT = "state";

export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}
