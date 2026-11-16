import type * as ts from "typescript";
import {
  isSafeFileNameSegment,
  type CharacterDef,
  type Story,
} from "@lingfan-engine/core";
import type { StorySourceConfig } from "../config/story-config.ts";
import {
  defaultStoriesBuildTexts,
  type StoriesBuildTexts,
} from "../shared/index.ts";
import {
  buildGraph,
  compileLabelColumns,
  compileStoryFile,
  createAssembleSession,
  DiagBag,
  resolveStart,
  type CompileDiag,
  type CompiledStory,
  type Graph,
  type SceneRegistryEntry,
  type UiRegistryEntry,
} from "./story-compiler/index.ts";
import type { CompilerConstValues } from "./compiler-contract.ts";
import type { AliasResolver } from "./story-compiler/graph/scan/alias.ts";

export interface CompileStoriesResult {
  stories: Array<{ columnId: string; sourceRelPath: string; story: Story }>;
  diags: CompileDiag[];
  entryColumnId?: string;
}

export function compileStories(input: {
  readonly root: string;
  readonly sourcesDir: string;
  /** 布局声明（config.ts 求值产物；folders/start 必需）——图谱层只消费，不再解析 config */
  readonly config: StorySourceConfig;
  readonly stories: readonly string[];
  readonly modules: readonly string[];
  /** 编译期求值喂入；缺省 = 无被求值文件（行为不变） */
  readonly constValues?: CompilerConstValues;
  /** 字体名注册表（Resources/Fonts 文件名去扩展名）；缺省 = 空注册表，引用字体名即 fail-closed */
  readonly fontNames?: ReadonlySet<string>;
  /** 全工程角色表（编排层模块层声明收集产物）；缺省 = 空表，无前置角色命令 */
  readonly characters?: ReadonlyMap<string, CharacterDef>;
  /** 文案注入（Partial）；缺省 = 内建缺省文案（即构建层的既有文案） */
  readonly texts?: Partial<StoriesBuildTexts>;
  /** 工程 `tsconfig.json` 的 paths 解析器；缺省 = 只认相对路径 */
  readonly alias?: AliasResolver;
  /**
   * UI 名注册表（扫描 `ui/` 目录的产物）；缺省 = 空表。
   * 由编排层扫描后注入，编译器自己不读 UI 目录。
   */
  readonly uiRegistry?: readonly UiRegistryEntry[];
  /**
   * 场景名注册表（扫描 `scenes/` 目录的产物）；缺省 = 空表。
   * 与 `uiRegistry` 分开传：前者是列身体，后者是叠加层，合并会混掉两种挂载语义。
   */
  readonly sceneRegistry?: readonly SceneRegistryEntry[];
}): CompileStoriesResult {
  const texts: StoriesBuildTexts = {
    ...defaultStoriesBuildTexts,
    ...input.texts,
  };
  const diags = new DiagBag();
  const graph = buildGraph(
    input.sourcesDir,
    diags,
    input.config,
    input.constValues,
    texts,
    input.alias,
    input.uiRegistry,
    input.sceneRegistry,
  );
  if (graph === null) return { stories: [], diags: diags.list() };
  const entry = resolveStart(graph, diags);

  const session = createAssembleSession(
    input.fontNames,
    texts,
    input.characters,
  );
  const stories: CompiledStory[] = [];
  for (const rel of graph.coveredStories) {
    const compiled = compileStoryFile(session, graph, diags, rel);
    if (compiled !== undefined) stories.push(compiled);
  }
  // 跳转目标补列：被 `jump("X")`／`navigate("X")` 指过却不是故事列的导出函数，
  // 按需补成 `kind:"flow"` 列——名字因此进列名注册表，跳转才能逐句回退。
  const known = new Set(stories.map((item) => item.columnId.toLowerCase()));
  stories.push(...compileLabelColumns(session, graph, diags, known));
  checkColumnIds(graph, diags, stories, texts);

  const list = diags.list();
  if (list.length > 0) return { stories: [], diags: list };
  return {
    stories,
    diags: [],
    entryColumnId: entry,
  };
}

function checkColumnIds(
  graph: Graph,
  diags: DiagBag,
  stories: readonly CompiledStory[],
  texts: StoriesBuildTexts,
): void {
  const seen = new Map<string, string>();
  for (const item of stories) {
    const record = graph.records.get(item.sourceRelPath);
    if (record === undefined) continue;
    // 列名要么来自故事文件的 default 导出函数，要么来自按需补列的导出函数；
    // 两种来源都要过同一条 id 规则，只是报错落点不同（后者没有 default 声明）。
    const pos: ts.Node = record.story?.node ?? record.sf;
    if (item.columnId === "" || !isSafeFileNameSegment(item.columnId)) {
      diags.add(
        record.rel,
        record.sf,
        pos,
        texts.columnIdUnsafe(item.columnId),
      );
      continue;
    }
    const lower = item.columnId.toLowerCase();
    const prev = seen.get(lower);
    if (prev !== undefined) {
      diags.add(
        record.rel,
        record.sf,
        pos,
        texts.columnIdDuplicate(item.columnId, prev),
      );
      continue;
    }
    seen.set(lower, item.sourceRelPath);
  }
}
