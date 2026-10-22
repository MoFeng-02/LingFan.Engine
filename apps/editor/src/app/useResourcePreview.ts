import { computed, ref } from "vue";
import type { Ref, ShallowRef } from "vue";
import type { Story } from "@lingfan-engine/core";
import { firstColumnIdOfSourcePath } from "@lingfan-engine/editor";
import {
  columnIdOfDocument,
  kindOfPath,
  storyDocumentPath,
  viewOfKind,
  type ResourceKind,
  type Workspace,
  type DialogPort,
} from "../domain";
import type { ProjectPorts } from "./useProjectPorts";
import type { EditorSaveState } from "./useEditorSave";

export interface ResourcePreviewDeps {
  story: ShallowRef<Story>;
  projectTree: Ref<Story | undefined>;
  workspace: Workspace;
  selectedColumnId: Ref<string>;
  selectDocument: (path: string) => void;
  dialog: DialogPort;
  ports: Pick<ProjectPorts, "readTextFn" | "saveTextFn">;
  /** 复用保存域的三态（saving/saveError/saveNotice）——译文表保存共用同一状态条 */
  saveStatus: Pick<EditorSaveState, "saving" | "saveError" | "saveNotice">;
}

/**
 * 资源预览域：非故事资源（媒体/清单/只读）的中心区预览面。
 * 故事文档路由到多文档工作区；其余资源按分派表落到 activeResource 预览。
 */
export function useResourcePreview(deps: ResourcePreviewDeps) {
  const {
    story,
    projectTree,
    workspace,
    selectedColumnId,
    selectDocument,
    dialog,
    ports,
    saveStatus,
  } = deps;
  const { readTextFn, saveTextFn } = ports;

  /** 打开资源：按分派表路由到对应视图（未命中 ⇒ 只读，不报错） */
  function openResource(path: string): void {
    const kind = kindOfPath(path);
    const spec = viewOfKind(kind);
    if (spec.view === "story") {
      // 故事文档身份 = 合成路径 `Stories/<列id>.json`；但磁盘上的故事文件可能是
      // **多列 `.story`**（真实工程形态，路径与列 id 天然不同族）——
      // 反查口径：**sourcePath === 该文件的第一个列**（列序，工程级事实）。
      const columnId =
        columnIdOfDocument(path) ??
        firstColumnIdOfSourcePath(projectTree.value ?? story.value, path);
      if (columnId === undefined) {
        // .story 文件里没有任何可解析列（坏档 / 全是注释）——如实告知，不静默无反应
        void dialog.notify({
          title: "该故事文件没有可打开的场景",
          message: `「${path}」里没有解析出任何列（可能是空文件或结构损坏）。`,
          tone: "warning",
        });
        return;
      }
      // 文档身份恒 = `storyDocumentPath(columnId)`（**不是**磁盘文件路径——
      //   .story 文件路径只是反查键；用它开档会破坏「一文档 = 一列」的身份不变量，
      //   redistribute / selectedColumnId 同步全部失配）。默认路径工程两者同形，行为不变。
      const docPath = storyDocumentPath(columnId);
      if (workspace.get(docPath) !== undefined) {
        selectDocument(docPath);
      } else {
        // 工程里已存在的列但未打开 ⇒ 打开它（真实单列文档，从整工程树切出）
        const column = (projectTree.value ?? story.value).columns.find(
          (c) => c.id === columnId,
        );
        if (column === undefined) return;
        workspace.open(docPath, "story", {
          ...(projectTree.value ?? story.value),
          entry: columnId,
          columns: [column],
        });
        selectDocument(docPath);
      }
      selectedColumnId.value = columnId;
      return;
    }
    if (spec.editable || spec.view === "media" || spec.view === "readonly") {
      // 非故事资源：不进 workspace 标签（没有独立会话/写回路径），
      // 而是以「资源预览」形态在中心区显示（状态在 activeResource 上）。
      activeResource.value = path;
      void loadResourceText(path);
    }
  }

  /* ——— 非故事资源（中心区） ——— */
  const activeResource = ref<string | undefined>(undefined);
  /** 资源原始文本（读取中 = `undefined`；失败 = `readError` 有值） */
  const activeSource = ref<string | undefined>(undefined);
  const readError = ref("");
  /** 读资源文本：失败**如实报错**（不静默显示空内容——那会被误读成"文件是空的"） */
  async function loadResourceText(path: string): Promise<void> {
    activeSource.value = undefined;
    readError.value = "";
    const read = readTextFn.value;
    if (read === undefined) {
      readError.value = "未打开工程（无资源读取能力）";
      return;
    }
    try {
      activeSource.value = await read(path);
    } catch (error: unknown) {
      readError.value = `读取失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /** 活动资源的种类与视图分派（分派表是路由唯一事实源） */
  const activePath = computed<string>(
    () => activeResource.value ?? workspace.activePath ?? "",
  );
  const activeKind = computed<ResourceKind>(() =>
    activeResource.value !== undefined
      ? kindOfPath(activeResource.value)
      : "story",
  );
  const activeSpec = computed(() => viewOfKind(activeKind.value));
  /**
   * 媒体种类（收窄）：分派表只在 `image`/`audio`/`video` 时路由到 `MediaView`，
   * 但类型系统不知道那张表的内容 ⇒ 显式收窄而非在组件里 cast。
   */
  const activeMediaKind = computed<"image" | "audio" | "video" | "other">(() => {
    const kind = activeKind.value;
    return kind === "image" || kind === "audio" || kind === "video"
      ? kind
      : "other";
  });
  const activeReadOnlyReason = computed(() => {
    if (activeKind.value === "saves")
      return "运行时产物：Saves 归工程运行时，编辑器不提供编辑面";
    return "未识别的资源类型：编辑器不提供编辑面（可用外部工具查看）";
  });

  /** 保存非故事文本资源（译文表 / 清单） */
  async function saveTextResource(path: string, text: string): Promise<void> {
    const run = saveTextFn.value;
    if (run === undefined) {
      readError.value = "该资源类型尚不支持保存（无写回能力）";
      return;
    }
    saveStatus.saving.value = true;
    saveStatus.saveError.value = "";
    saveStatus.saveNotice.value = "";
    try {
      const report = await run(path, text);
      saveStatus.saveNotice.value = `已保存：写入 ${report.written.length} 个文件`;
    } catch (error: unknown) {
      saveStatus.saveError.value = `保存失败：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      saveStatus.saving.value = false;
    }
  }

  return {
    openResource,
    activeResource,
    activeSource,
    readError,
    activePath,
    activeKind,
    activeSpec,
    activeMediaKind,
    activeReadOnlyReason,
    saveTextResource,
  };
}

export type ResourcePreviewState = ReturnType<typeof useResourcePreview>;
