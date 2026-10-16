import {
  isSafeFileNameSegment,
  type CharacterDef,
  type Story,
} from "@lingfan/engine";
import type { StorySourceConfig } from "../config/story-config.ts";
import {
  defaultStoriesBuildTexts,
  type StoriesBuildTexts,
} from "../shared/index.ts";
import {
  buildGraph,
  compileStoryFile,
  createAssembleSession,
  DiagBag,
  resolveStart,
  type CompileDiag,
  type CompiledStory,
  type Graph,
} from "./story-compiler/index.ts";
import type { CompilerConstValues } from "./compiler-contract.ts";

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
    const storyName = record?.story?.node.name;
    if (
      record === undefined ||
      record.story === null ||
      storyName === undefined
    )
      continue;
    if (item.columnId === "" || !isSafeFileNameSegment(item.columnId)) {
      diags.add(
        record.rel,
        record.sf,
        storyName,
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
        storyName,
        texts.columnIdDuplicate(item.columnId, prev),
      );
      continue;
    }
    seen.set(lower, item.sourceRelPath);
  }
}
