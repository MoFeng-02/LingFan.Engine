import { isSafeFileNameSegment, type Story } from "@lingfan/engine";
import { DiagBag, buildGraph, resolveStart, type CompileDiag, type Graph } from "./story-compiler/graph";
import { compileStoryFile, createAssembleSession, type CompiledStory } from "./story-compiler/assemble";
import type { CompilerConstValues } from "./compiler-contract";

export interface CompileStoriesResult {
  stories: Array<{ columnId: string; sourceRelPath: string; story: Story }>;
  diags: CompileDiag[];
  entryColumnId?: string;
  /**
   * 全工程 `defineVars({...})` 清单里的变量键（已合并去重排序）。
   *
   * 类型面生成器的数据源之一：变量键在插值里合法，但可能从不出现在 op 流中，
   * 故既推不出自列集也推不出自 state schema。
   */
  defineVarsKeys?: string[];
}

export function compileStories(input: {
  readonly root: string;
  readonly sourcesDir: string;
  readonly stories: readonly string[];
  readonly modules: readonly string[];
  /** 编译期求值喂入（§十二）；缺省 = 无被求值文件（行为不变） */
  readonly constValues?: CompilerConstValues;
}): CompileStoriesResult {
  const diags = new DiagBag();
  const graph = buildGraph(input.sourcesDir, diags, input.constValues);
  if (graph === null) return { stories: [], diags: diags.list() };
  const entry = resolveStart(graph, diags);

  const session = createAssembleSession();
  const stories: CompiledStory[] = [];
  for (const rel of graph.coveredStories) {
    const compiled = compileStoryFile(session, graph, diags, rel);
    if (compiled !== undefined) stories.push(compiled);
  }
  checkColumnIds(graph, diags, stories);

  const list = diags.list();
  if (list.length > 0) return { stories: [], diags: list };
  return { stories, diags: [], entryColumnId: entry, defineVarsKeys: collectDefineVarsKeys(graph) };
}

/** 全工程 defineVars 键合并去重（排序保证生成物文本稳定） */
function collectDefineVarsKeys(graph: Graph): string[] {
  const keys = new Set<string>();
  for (const record of graph.records.values()) {
    for (const key of record.defineVarsKeys) keys.add(key);
  }
  return [...keys].sort();
}

function checkColumnIds(graph: Graph, diags: DiagBag, stories: readonly CompiledStory[]): void {
  const seen = new Map<string, string>();
  for (const item of stories) {
    const record = graph.records.get(item.sourceRelPath);
    const storyName = record?.story?.node.name;
    if (record === undefined || record.story === null || storyName === undefined) continue;
    if (item.columnId === "" || !isSafeFileNameSegment(item.columnId)) {
      diags.add(record.rel, record.sf, storyName, `列 id \`${item.columnId}\` 为空或含不安全字符（E06）`);
      continue;
    }
    const lower = item.columnId.toLowerCase();
    const prev = seen.get(lower);
    if (prev !== undefined) {
      diags.add(record.rel, record.sf, storyName, `列 id \`${item.columnId}\` 与 ${prev} 重复（大小写不敏感，E06）`);
      continue;
    }
    seen.set(lower, item.sourceRelPath);
  }
}
