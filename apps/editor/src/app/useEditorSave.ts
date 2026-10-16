import { computed, ref } from "vue";
import type { ComputedRef, Ref, ShallowRef } from "vue";
import type { KeyValueStorage } from "@lingfan/editor";
import type { ProjectWriteReport, Story } from "@lingfan/engine";
import {
  describeNormalization,
  readSkipNormalizationNotice,
  writeSkipNormalizationNotice,
} from "@lingfan/editor";
import { columnIdOfDocument, type Workspace } from "../domain";
import { UNBOUND_HINT, type ProjectPorts } from "./useProjectPorts";

export interface EditorSaveDeps {
  story: ShallowRef<Story>;
  /** 活动文档会话（整工程保存路径用 markSaved 钉基线） */
  session: () => import("@lingfan/editor").EditorSession;
  workspace: Workspace;
  /** 各文档脏态（标签栏脏点投影；单文档保存后刷新） */
  documentDirty: Ref<Set<string>>;
  /** 活动会话脏标记（bindActive 投影） */
  dirty: Ref<boolean>;
  /** 诊断错误数（fail-closed：有错误禁止保存） */
  errorCount: ComputedRef<number>;
  ports: Pick<
    ProjectPorts,
    "saveFn" | "saveColumnFn" | "inspectSaveFn" | "saveHint" | "projectRoot"
  >;
  /** 本机视图偏好存储（「不再提示」勾选；失败静默 = 仅本次会话有效） */
  storage: () => KeyValueStorage | undefined;
  /** 导出下载（平台实现由组合根注入；本层不碰 DOM） */
  downloadFile: (fileName: string, text: string) => void;
}

/**
 * 保存域：整工程保存（规范化检测 + 确认区）、单文档保存、导出。
 * 规范化确认语义：检测有发现时暂存保存动作（确认后执行），界面展示
 * 「将被转换/移除的文件」清单。「不再提示」为本机视图偏好（不入故事 JSON）。
 */
export function useEditorSave(deps: EditorSaveDeps) {
  const {
    story,
    session,
    workspace,
    documentDirty,
    dirty,
    errorCount,
    ports,
    storage,
    downloadFile,
  } = deps;

  const saving = ref(false);
  const saveError = ref("");
  const saveNotice = ref("");
  const normalizationNotice = ref<string[]>([]);
  const pendingSave = ref<
    ((s: Story) => Promise<ProjectWriteReport>) | undefined
  >(undefined);
  const skipNormalizationNotice = ref(readSkipNormalizationNotice(storage()));

  /** 保存可用性：未绑定工程 / 只读取径 / 保存中 / 无改动 / 有错误 → 禁用（fail-closed） */
  const canSave = computed(
    () =>
      ports.saveFn.value !== undefined &&
      !saving.value &&
      dirty.value &&
      errorCount.value === 0,
  );
  const saveTooltip = computed(() => {
    if (ports.saveFn.value === undefined) {
      return ports.saveHint.value !== "" ? ports.saveHint.value : UNBOUND_HINT;
    }
    if (errorCount.value > 0) {
      return `存在 ${errorCount.value} 个错误，先修复再保存（fail-closed）`;
    }
    if (!dirty.value) return "无未保存更改";
    return `保存到 ${ports.projectRoot.value}`;
  });

  /**
   * 保存回磁盘：捕获**实际写出的那个引用**（乐观并发——await 期间用户又改，
   * 基线钉在 target 上仍 dirty，不误清）；成功后 `markSaved(target)`。
   * 保存前先做规范化检测（用户已「不再提示」则跳过检测）——有发现时**不执行**
   * 保存，展示清单等确认（跳过提示 ≠ 丢弃保存：确认/取消后状态干净）。
   */
  async function onSave(): Promise<void> {
    if (ports.saveColumnFn.value !== undefined) {
      await saveActiveDocument();
      return;
    }
    const run = ports.saveFn.value;
    if (run === undefined || saving.value) return;
    const target = story.value;
    if (!skipNormalizationNotice.value) {
      const finding = ports.inspectSaveFn.value?.(target);
      if (finding !== undefined) {
        const lines = describeNormalization(finding);
        if (lines.length > 0) {
          pendingSave.value = run;
          normalizationNotice.value = lines;
          saveNotice.value = ""; // 确认区取代旧成功提示，避免双提示混淆
          return;
        }
      }
    }
    await performSave(run, target);
  }

  /**
   * 保存**活动文档**（多文档面的正确路径）：只落该列文件。
   *
   * 与整工程 `save` 的差别不是"少写几个文件"，而是**防丢数据**：整工程路径要的是
   * 「全部标签的当前状态重组出的树」，而本路径只承诺「活动标签这一个文件」。
   * 规范化检测属于**整工程**关注点（多列文件规范化成单列），单文档路径不适用。
   */
  async function saveActiveDocument(): Promise<void> {
    const run = ports.saveColumnFn.value;
    const doc = workspace.activeDocument;
    if (run === undefined || doc === undefined || saving.value) return;
    const columnId = columnIdOfDocument(doc.path);
    // 非故事文档（媒体 / 译文表等）没有写回路径 ⇒ 如实不可存，不装作能存
    if (columnId === undefined) {
      saveError.value = "该资源类型尚不支持保存（仅支持 .story 文档写回）";
      return;
    }
    saving.value = true;
    saveError.value = "";
    saveNotice.value = "";
    const target = doc.session.story;
    try {
      const report = await run(columnId, target);
      doc.session.markSaved(target);
      documentDirty.value = new Set(workspace.dirtyPaths);
      saveNotice.value = `已保存：写入 ${report.written.length} 个文件`;
    } catch (error: unknown) {
      saveError.value = `保存失败：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      saving.value = false;
    }
  }

  /** 确认区内的实际保存（onSave 与「继续保存」共用；target 取确认时刻的当前树） */
  async function performSave(
    run: (s: Story) => Promise<ProjectWriteReport>,
    target: Story,
  ): Promise<void> {
    saving.value = true;
    saveError.value = "";
    saveNotice.value = "";
    try {
      const report = await run(target);
      session().markSaved(target);
      saveNotice.value =
        `已保存：写入 ${report.written.length} 个文件` +
        (report.deleted.length > 0
          ? `，删除 ${report.deleted.length} 个旧文件`
          : "");
    } catch (error: unknown) {
      saveError.value = `保存失败：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      saving.value = false;
    }
  }

  /** 「继续保存」：按确认时刻的当前树执行暂存的保存动作（乐观并发语义不变） */
  async function confirmNormalization(): Promise<void> {
    const run = pendingSave.value;
    cancelNormalization();
    if (run === undefined || saving.value) return;
    await performSave(run, story.value);
  }

  /** 收起确认区（取消或已被更高优先级状态取代）；暂存的动作一并作废 */
  function cancelNormalization(): void {
    pendingSave.value = undefined;
    normalizationNotice.value = [];
  }

  /** 「不再提示」勾选：立即落本机偏好（失败静默 = 仅本次会话有效） */
  function onSkipNormalizationChange(): void {
    writeSkipNormalizationNotice(storage(), skipNormalizationNotice.value);
  }

  /** 导出当前故事为 JSON 文件；落盘动作由组合根注入的实现完成 */
  function onExport(): void {
    downloadFile(
      `${story.value.id}.json`,
      JSON.stringify(story.value, null, 2),
    );
  }

  return {
    saving,
    saveError,
    saveNotice,
    normalizationNotice,
    skipNormalizationNotice,
    canSave,
    saveTooltip,
    onSave,
    confirmNormalization,
    cancelNormalization,
    onSkipNormalizationChange,
    onExport,
  };
}

export type EditorSaveState = ReturnType<typeof useEditorSave>;
