import { isSafeFileNameSegment, type Story } from "@lingfan/engine";
import type { StorySourceConfig } from "../config/story-config";
import {
  DiagBag,
  buildGraph,
  resolveStart,
  type CompileDiag,
  type Graph,
} from "./story-compiler/graph";
import {
  compileStoryFile,
  createAssembleSession,
  type CompiledStory,
} from "./story-compiler/assemble";
import type { CompilerConstValues } from "./compiler-contract";

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
  /** 编译期求值喂入（对应章节）；缺省 = 无被求值文件（行为不变） */
  readonly constValues?: CompilerConstValues;
  /** 字体名注册表（Resources/Fonts 文件名去扩展名）；缺省 = 空注册表，引用字体名即 fail-closed */
  readonly fontNames?: ReadonlySet<string>;
}): CompileStoriesResult {
  const diags = new DiagBag();
  const graph = buildGraph(input.sourcesDir, diags, input.config, input.constValues);
  if (graph === null) return { stories: [], diags: diags.list() };
  const entry = resolveStart(graph, diags);

  const session = createAssembleSession(input.fontNames);
  const stories: CompiledStory[] = [];
  for (const rel of graph.coveredStories) {
    const compiled = compileStoryFile(session, graph, diags, rel);
    if (compiled !== undefined) stories.push(compiled);
  }
  checkColumnIds(graph, diags, stories);

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
        `列 id \`${item.columnId}\` 为空或含不安全字符（E06）`,
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
        `列 id \`${item.columnId}\` 与 ${prev} 重复（大小写不敏感，E06）`,
      );
      continue;
    }
    seen.set(lower, item.sourceRelPath);
  }
}
