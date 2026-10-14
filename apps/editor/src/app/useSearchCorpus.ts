import { computed, ref, watch } from "vue";
import type { ComputedRef, Ref } from "vue";
import {
  kindOfPath,
  searchResources,
  type ResourceNode,
  type SearchCorpus,
  type Workspace,
} from "../domain";

export interface SearchCorpusDeps {
  /** 按逻辑路径读资源文本（未打开工程 = undefined ⇒ 语料直接置空态） */
  readTextFn: Ref<((path: string) => Promise<string>) | undefined>;
  /** 工程资源集（诊断供给侧投影） */
  resourcePaths: ComputedRef<readonly string[]>;
  /** 侧栏内页：切到搜索/最近 ⇒ 按需拉语料 */
  leftTab: Ref<string>;
  /** 「最近」过滤判据：已打开过的文档才算最近 */
  workspace: Workspace;
}

/** 内容搜索语料（逻辑路径 → 原始文本）：**按需加载并缓存**，不预读全部资源 */
export function useSearchCorpus(deps: SearchCorpusDeps) {
  const { readTextFn, resourcePaths, leftTab, workspace } = deps;

  const searchKeyword = ref("");
  const searchCorpus = ref<SearchCorpus>(new Map());
  const corpusLoaded = ref(false);
  const corpusLoading = ref(false);
  /** 语料可含哪些文件：跳过媒体（巨大且文本检索无意义）与 `.enc`（密文） */
  function isSearchable(path: string): boolean {
    if (path.endsWith(".enc")) return false;
    const kind = kindOfPath(path);
    return (
      kind !== "image" && kind !== "audio" && kind !== "video" && kind !== "saves"
    );
  }
  /** 加载语料：逐个读，**单个失败不阻断**（跳过即可，如实计入失败数） */
  async function ensureCorpus(): Promise<void> {
    if (corpusLoaded.value || corpusLoading.value) return;
    const read = readTextFn.value;
    if (read === undefined) {
      corpusLoaded.value = true;
      return;
    }
    corpusLoading.value = true;
    const next: Record<string, string> = {};
    for (const path of resourcePaths.value) {
      if (!isSearchable(path)) continue;
      try {
        next[path] = await read(path);
      } catch {
        // 读不到就跳过（不作为空内容条目出现）
      }
    }
    searchCorpus.value = new Map(Object.entries(next));
    corpusLoaded.value = true;
    corpusLoading.value = false;
  }
  /** 切到搜索面板 ⇒ 按需拉语料 */
  watch(
    () => leftTab.value,
    (tab) => {
      if (tab === "search" || tab === "recent") void ensureCorpus();
    },
  );
  /** 语料作废（换工程时调用：旧语料是另一个工程的内容）。
   *  **不用 `watch(resourcePaths)`**：`watch` 会**立即求值**源以建立依赖，
   *  而 `resourcePaths` 依赖的 `diagnosticSupply` 在 setup 靠后处才声明 ⇒ TDZ 崩
   *  （`Cannot access 'diagnosticSupply' before initialization`）。
   *  改在**工程真正变化的地方**（`applyOpened` / `unbindProject`）显式调用。 */
  function invalidateCorpus(): void {
    searchCorpus.value = new Map();
    corpusLoaded.value = false;
  }
  const searchReport = computed(() =>
    searchResources(searchCorpus.value, searchKeyword.value),
  );
  /** 搜索过滤：匹配**文件名或完整路径**（大小写不敏感）；空关键词 = 不过滤 */
  const searchFilter = (node: ResourceNode): boolean => {
    const q = searchKeyword.value.trim().toLowerCase();
    if (q === "") return false;
    return (
      node.name.toLowerCase().includes(q) || node.path.toLowerCase().includes(q)
    );
  };
  /** 最近打开：只出已打开过的文档（= 当前标签集合；标签即已打开资源） */
  const recentFilter = (node: ResourceNode): boolean =>
    workspace.get(node.path) !== undefined;

  return {
    searchKeyword,
    searchCorpus,
    corpusLoaded,
    corpusLoading,
    isSearchable,
    ensureCorpus,
    invalidateCorpus,
    searchReport,
    searchFilter,
    recentFilter,
  };
}

export type SearchCorpusState = ReturnType<typeof useSearchCorpus>;
