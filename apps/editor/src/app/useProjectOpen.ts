import type { Ref } from "vue";
import { DEFAULT_LAYER_Z } from "@lingfan/engine";
import type { Story } from "@lingfan/engine";
import {
  storyDocumentPath,
  type EditorDocument,
  type Workspace,
} from "../domain";
import type {
  LastProjectEntry,
  OpenedProject,
  ProjectOpener,
} from "../contracts";
import type { DiagnosticSupply, ProjectPorts } from "./useProjectPorts";
import { UNBOUND_HINT } from "./useProjectPorts";
import type { EditorSaveState } from "./useEditorSave";

export interface ProjectOpenDeps {
  opener: ProjectOpener;
  /** 上次工程一键重开入口（IDB 异步就绪后填充；无 = 按钮不渲染） */
  lastProject?: Ref<LastProjectEntry | undefined>;
  /**
   * 无 FSA 浏览器（Firefox/Safari）的兜底取径：打开目录选择器。
   *
   * 打开选择器是 DOM 行为 ⇒ 由视图层提供（组合根拿模板 ref 实现），本层只发请求。
   */
  requestFallbackPicker: () => void;
  ports: ProjectPorts;
  diagnosticSupply: Ref<DiagnosticSupply | undefined>;
  projectTree: Ref<Story | undefined>;
  workspace: Workspace;
  openColumnDocument: (id: string) => void;
  bindActive: (doc: EditorDocument | undefined) => void;
  documentPaths: Ref<string[]>;
  selectedPointer: Ref<string | null>;
  selectedColumnId: Ref<string>;
  invalidateCorpus: () => void;
  saveStatus: Pick<
    EditorSaveState,
    "saveError" | "saveNotice" | "cancelNormalization"
  >;
  activeResource: Ref<string | undefined>;
  activeSource: Ref<string | undefined>;
}

/** 工程打开域：两种取径（FSA / 文件 input）都经组合根注入的 opener；失败只提示，不动当前工程 */
export function useProjectOpen(deps: ProjectOpenDeps) {
  const {
    opener,
    lastProject,
    requestFallbackPicker,
    ports,
    diagnosticSupply,
    projectTree,
    workspace,
    openColumnDocument,
    bindActive,
    documentPaths,
    selectedPointer,
    selectedColumnId,
    invalidateCorpus,
    saveStatus,
    activeResource,
    activeSource,
  } = deps;
  const openError = ports.openError;

  /** 打开工程（两种取径都经组合根注入的 opener；失败只提示，不动当前工程） */
  async function openProject(): Promise<void> {
    openError.value = "";
    if (!opener.supportsPicker) {
      requestFallbackPicker(); // 无 FSA（Firefox/Safari）→ 目录 input 兜底（视图层打开）
      return;
    }
    try {
      await applyOpened(await opener.pick());
    } catch (error: unknown) {
      openError.value = `打开工程失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /** 「记住上次工程」：一键重开（点击即手势，读权限按需申请） */
  async function reopenLastProject(): Promise<void> {
    const entry = lastProject?.value;
    if (entry === undefined) return;
    openError.value = "";
    try {
      await applyOpened(await entry.reopen());
    } catch (error: unknown) {
      openError.value = `重新打开失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * 目录 input 的快照取径：视图层已把 `FileList` 取成数组并清空 input 值，
   * 本层只收文件快照（元素读取属 DOM 行为，留在视图层）。
   */
  async function openFromFiles(files: readonly File[]): Promise<void> {
    if (files.length === 0) return;
    openError.value = "";
    try {
      await applyOpened(await opener.fromFiles(files));
    } catch (error: unknown) {
      openError.value = `打开工程失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  function applyOpened(opened: OpenedProject | undefined): void {
    if (opened === undefined) return; // 用户取消
    // 按列装载**真实单列文档**（标签页的语义 = 一个资源 = 一个会话）：
    // 每列从工程树里抽出自己那一份，各持独立 `EditorSession` ⇒ 标签间改写互不覆盖。
    // 不用「整棵树塞进每个标签」的写法——那会让两个标签各持一份**旧副本**，
    // 后保存的覆盖先保存的（这正是标签独立会话要防的数据丢失）。
    const tree = opened.story;
    projectTree.value = tree; // 诊断基准 = 整工程树（跨列引用需全局视角）
    // 旧会话文档一律不带入（打开工程 = 新基线会话）：路径同名 ≠ 内容同源——
    // demo 会话占用的 `Stories/start.json` 在真实工程入口列同名时会被
    // 「已开：复用」判据接管，demo 内容会在保存时写坏真实工程。
    for (const doc of [...workspace.documents]) {
      workspace.close(doc.path);
    }
    // **只开入口列**：预开所有列会让大工程铺满标签
    //    （`Workspace` 容量 50 还会静默截断其余列），而「列 = 文档」的语义**不需要预开**——
    //    用户点到哪一列，`selectColumn` 就为哪一列建会话（见 `openColumnDocument`）。
    openColumnDocument(tree.entry);
    // 标签顺序 = 列序（= 文件路径码元序，叙事语义）；未开的列没有文档，不进标签。
    const ordered = tree.columns
      .map((column) => storyDocumentPath(column.id))
      .filter((path) => workspace.get(path) !== undefined);
    documentPaths.value = ordered;
    workspace.activate(storyDocumentPath(tree.entry));
    bindActive(workspace.activeDocument);
    selectedPointer.value = null;
    selectedColumnId.value = tree.entry;
    ports.resourcePort.value = opened.resourcePort;
    ports.layerZ.value = opened.layerZ; // 预览用工程层级表解析实例级 z
    diagnosticSupply.value = opened.diagnosticSupply; // 资源/译文检查器生效
    ports.projectRoot.value = opened.root;
    ports.degradedOpen.value = opened.degraded; // 缺清单降级的事实显式上状态栏
    ports.saveFn.value = opened.save;
    ports.saveColumnFn.value = opened.saveColumn;
    ports.readTextFn.value = opened.readText;
    ports.saveTextFn.value = opened.saveText;
    invalidateCorpus(); // 换工程 ⇒ 旧语料作废（内容属于上一个工程）
    ports.inspectSaveFn.value = opened.inspectSave;
    ports.saveHint.value = opened.saveHint ?? "";
    saveStatus.saveError.value = "";
    saveStatus.saveNotice.value = "";
    saveStatus.cancelNormalization(); // 换工程：上一次暂存的确认已过期（基线随会话换新）
  }

  /**
   * 解绑磁盘工程：「新建 / 导入」是内存态故事，若保持绑定，
   * 一次误点保存会把示例/导入内容覆盖真实工程——故一律解绑。
   * 提示用**状态口径**（「未绑定」而非「你刚点了新建」）：绑定状态不随 undo 回滚，
   * 若文案携带历史，撤销「新建」后就会留下过期说明。
   */
  function unbindProject(): void {
    ports.saveFn.value = undefined;
    ports.saveColumnFn.value = undefined;
    ports.readTextFn.value = undefined;
    ports.saveTextFn.value = undefined;
    invalidateCorpus();
    activeResource.value = undefined;
    activeSource.value = undefined;
    ports.inspectSaveFn.value = undefined;
    ports.saveHint.value = UNBOUND_HINT;
    ports.projectRoot.value = "";
    ports.degradedOpen.value = undefined; // 解绑 = 降级态一并作废（绑定状态不随 undo 回滚）
    ports.resourcePort.value = undefined;
    ports.layerZ.value = DEFAULT_LAYER_Z; // 解绑后回内建层级表
    diagnosticSupply.value = undefined; // 解绑后回「无供给侧」= 检查器族跳过
    projectTree.value = undefined; // 诊断基准随之归零（回落到当前活动树）
    saveStatus.saveError.value = "";
    saveStatus.saveNotice.value = "";
    saveStatus.cancelNormalization(); // 解绑 = 保存能力消失，暂存的确认一并作废
  }

  /** 从磁盘重新供给（重开工程通道 —— 唯一已验证的重新枚举路径） */
  async function reloadFromDisk(): Promise<void> {
    const entry = lastProject?.value;
    if (entry === undefined) return;
    openError.value = "";
    try {
      await applyOpened(await entry.reopen());
    } catch (error: unknown) {
      openError.value = `热重载失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  return {
    openProject,
    reopenLastProject,
    openFromFiles,
    applyOpened,
    unbindProject,
    reloadFromDisk,
  };
}

export type ProjectOpenState = ReturnType<typeof useProjectOpen>;
