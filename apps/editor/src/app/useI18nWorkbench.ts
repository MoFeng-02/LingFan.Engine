import { computed } from "vue";
import type { Ref, ShallowRef } from "vue";
import type { Story } from "@lingfan/engine";
import {
  extractStoryKeys,
  columnStoryKey,
  groupKeysByStory,
  planOverlaySkeleton,
  type SkeletonLayoutChoice,
} from "@lingfan/editor";
import type { LangSummary } from "../components/panels";
import type { DiagnosticSupply, ProjectPorts } from "./useProjectPorts";
import type { LastProjectEntry, OpenedProject } from "../contracts";
import type { DialogPort } from "../domain";
import type { EditorSaveState } from "./useEditorSave";

export interface I18nWorkbenchDeps {
  story: ShallowRef<Story>;
  projectTree: Ref<Story | undefined>;
  /** 诊断供给（分语言键覆盖的来源；未打开工程 = undefined） */
  diagnosticSupply: Ref<DiagnosticSupply | undefined>;
  ports: Pick<ProjectPorts, "readTextFn" | "saveTextFn">;
  saveStatus: Pick<EditorSaveState, "saving" | "saveError" | "saveNotice">;
  dialog: DialogPort;
  /** 骨架落盘后的重开通道（重新枚举资源/重建供给的唯一已验证路径） */
  applyOpened: (opened: OpenedProject) => void;
  lastProject?: Ref<LastProjectEntry | undefined>;
}

/** 本地化工作台（聚合面；数据全部来自既有诊断供给，**零新增 IO**） */
export function useI18nWorkbench(deps: I18nWorkbenchDeps) {
  const {
    story,
    projectTree,
    diagnosticSupply,
    ports,
    saveStatus,
    dialog,
    applyOpened,
    lastProject,
  } = deps;
  const { readTextFn, saveTextFn } = ports;

  /**
   * 原文键全集（`extractStoryKeys` 消费整工程树 ⇒ 与诊断原文同口径）。
   * 未打开工程 = 空数组 ⇒ 工作台显示「无可译内容」而不是报错。
   */
  const i18nSources = computed<readonly string[]>(() =>
    extractStoryKeys(projectTree.value ?? story.value),
  );
  /** 各语言键集合（由供给侧的分语言视图投影；`Lang/` 不存在 = 空） */
  const i18nLangs = computed<readonly LangSummary[]>(() => {
    const byLang = diagnosticSupply.value?.overlayKeysByLang;
    if (byLang === undefined) return [];
    return [...byLang.entries()]
      .map(([lang, keys]) => ({
        lang,
        // 单文件形态用语言码本身作路径键（`Lang/{lang}.json`）；目录形态用 `main.json`
        files: new Map<string, readonly string[]>([
          [`Lang/${lang}/main.json`, [...keys].sort()],
        ]),
      }))
      .sort((a, b) => (a.lang < b.lang ? -1 : 1));
  });

  /**
   * 骨架生成（本地化工作台「新建语言」）：委托纯函数产出文件内容，落盘走**既有**写回端口。
   *
   * 增量语义：已存在的语言传 `existing` ⇒ `planOverlaySkeleton` 保留既有译文
   * （只补新键），不会把译者的工作抹掉。
   */
  async function generateLangSkeleton(request: {
    lang: string;
    layout: SkeletonLayoutChoice;
  }): Promise<void> {
    const run = saveTextFn.value;
    if (run === undefined) {
      await dialog.notify({
        title: "未绑定磁盘工程",
        message: "生成骨架需要写回能力。请先「打开工程」并授予编辑权限。",
        tone: "warning",
      });
      return;
    }
    // 每个故事 → 该故事的原文键（键 = 列产物路径相对 Stories/ 的路径，不含扩展名；
    // 多目录形态下产物路径 = 源文件路径镜像，与列 id 解耦）
    const tree = projectTree.value ?? story.value;
    const storyKeys = groupKeysByStory(
      new Map(
        tree.columns.map((c) => [
          columnStoryKey(c),
          extractStoryKeys({ ...tree, entry: c.id, columns: [c] }),
        ]),
      ),
    );
    // 增量：该语言已存在的译文（键 = 逻辑路径）
    const read = readTextFn.value;
    const existing = new Map<string, Record<string, string>>();
    for (const summary of i18nLangs.value) {
      if (summary.lang !== request.lang) continue;
      for (const path of summary.files.keys()) {
        if (read === undefined) break;
        const text = await read(path).catch(() => undefined);
        if (text === undefined) continue;
        try {
          const parsed: unknown = JSON.parse(text);
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            !Array.isArray(parsed)
          ) {
            existing.set(path, parsed as Record<string, string>);
          }
        } catch {
          // 坏 JSON 不当既有译文（骨架会重生成该文件；原坏文件由 diff 覆盖）
        }
      }
    }
    let files: ReturnType<typeof planOverlaySkeleton>;
    try {
      files = planOverlaySkeleton({
        lang: request.lang,
        layout: request.layout,
        storyKeys,
        existing,
      });
    } catch (error: unknown) {
      // 非法语言码等 ⇒ fail-closed，如实报错（不静默生成一半）
      await dialog.notify({
        title: "无法生成骨架",
        message: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
      return;
    }
    saveStatus.saving.value = true;
    try {
      for (const file of files) await run(file.path, file.content);
      saveStatus.saveNotice.value = `已生成 ${request.lang} 骨架：${files.length} 个文件`;
      // 骨架已落盘 ⇒ 重新枚举资源与译文键（`Lang/**` 结构变了，诊断与工作台都要跟上）。
      // 走既有「重开上次工程」通道（`entry.reopen()`）—— 它是**唯一**已验证的重新供给路径
      //   （重新枚举 + 重建 supply + 重投影），不另造第二条。
      const entry = lastProject?.value;
      if (entry !== undefined) {
        const opened = await entry.reopen();
        if (opened !== undefined) applyOpened(opened);
      }
    } catch (error: unknown) {
      saveStatus.saveError.value = `生成失败：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      saveStatus.saving.value = false;
    }
  }

  return { i18nSources, i18nLangs, generateLangSkeleton };
}

export type I18nWorkbenchState = ReturnType<typeof useI18nWorkbench>;
