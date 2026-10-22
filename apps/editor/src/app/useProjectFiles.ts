import { ref, shallowRef } from "vue";
import type { Ref, ShallowRef } from "vue";
import type { Story } from "@lingfan-engine/core";
import { EditorSession } from "@lingfan-engine/editor";
import {
  Workspace,
  columnIdOfDocument,
  storyDocumentPath,
  type DialogPort,
  type EditorDocument,
} from "../domain";

export interface ProjectFilesDeps {
  /** 启动故事（示例工程或打开后的入口列）——workspace 首个文档由此建立 */
  initialStory: Story;
  /** 应用内对话框（关闭脏文档标签前确认） */
  dialog: DialogPort;
  /** 工程树（单列切片的切片源；未打开工程 = undefined 用活动会话树） */
  projectTree: Ref<Story | undefined>;
}

/**
 * 多文档中枢（资源管理器）：**一个资源 = 一个文档 = 一个会话**。
 *
 * 视图族零改动的接法：`session` 永远是**活动文档**的会话（`bindActive` 重绑），
 * 十一个组件经 `EDITOR_API_KEY` 消费的那份引用因此始终指向当前标签。
 * 标签切换 = 重绑 + 重投影状态，不触碰任何组件。
 */
export function useProjectFiles(deps: ProjectFilesDeps) {
  const { initialStory, dialog, projectTree } = deps;

  let session = new EditorSession(initialStory);
  const workspace = new Workspace();
  workspace.open(
    storyDocumentPath(initialStory.entry),
    "story",
    initialStory,
  );
  /** 文档态（供标签栏渲染；空数组 = 无标签，界面据此走空态） */
  const documentPaths = ref<string[]>([storyDocumentPath(initialStory.entry)]);
  const documentKinds = ref(
    new Map<string, string>([
      [storyDocumentPath(initialStory.entry), "story"],
    ]),
  );
  const documentDirty = ref(new Set<string>());
  const undoDepth = ref(0);
  const redoDepth = ref(0);
  const dirty = ref(false);
  const selectedColumnId = ref<string>(session.story.entry);
  const selectedPointer = ref<string | null>(null);
  let unsubscribeSession: (() => void) | undefined;
  /**
   * **shallowRef**：会话树靠「commit 恒换引用」运作，从不原地深改——
   * 深代理（`ref`）会让 `story.value` 变成 proxy ≠ `session.current` 原始引用，
   * `markSaved(story.value)` 后 `dirty = current !== saved` **恒真**（保存后「● 未保存」
   * 永不消失）。浅引用直存直取，与乐观并发语义精确对齐。
   */
  const story = shallowRef<Story>(session.story);

  /** 重绑到某文档的会话：订阅状态回投到视图面（`attachSession` 的同款投影） */
  function bindActive(doc: EditorDocument | undefined): void {
    if (doc === undefined) return;
    unsubscribeSession?.();
    unsubscribeSession = doc.session.subscribe((next: Story) => {
      story.value = next;
      undoDepth.value = doc.session.undoDepth;
      redoDepth.value = doc.session.redoDepth;
      dirty.value = doc.session.dirty;
      // 标签上的脏点也必须在这里刷新——编辑动作**只**触发会话订阅，
      //   不触发 workspace 结构变更（结构没变）⇒ 靠结构订阅刷新会让标签点**永不亮**。
      //   工具栏与标签栏是同一事实的两处投影。
      documentDirty.value = new Set(workspace.dirtyPaths);
    });
    session = doc.session;
    story.value = session.story;
    undoDepth.value = session.undoDepth;
    redoDepth.value = session.redoDepth;
    dirty.value = session.dirty;
    documentDirty.value = new Set(workspace.dirtyPaths);
  }

  /**
   * 换会话基线与绑定订阅：打开工程 = **新基线**（不是一次 undo——
   * 否则撤销会退回上一个工程的树）。
   *
   * 多文档面：先落进 `workspace`（成为活动文档），再由 `bindActive` 统一重绑——
   * 这样「打开工程」与「切标签」走**同一条**绑定路径（不新增第二处投影逻辑）。
   */
  function attachSession(next: EditorSession): void {
    workspace.open(storyDocumentPath(next.story.entry), "story", next.story);
    bindActive(workspace.activeDocument);
  }
  attachSession(session);

  /** 会话取用器：`bindActive` 会重绑 `session`，跨模块一律经它取当前值 */
  function getSession(): EditorSession {
    return session;
  }

  /**
   * 活动文档路径的**响应式投影**。
   *
   * `workspace` 是普通类实例（非 reactive）——模板里读 `workspace.activePath`
   * 靠「其他 ref 变更带动重渲染」碰巧刷新，而 **computed 读它则永不重算**
   * （资源树高亮会卡在挂载初值，切列不跟）。订阅回调里显式投影成 ref，
   * 一切「随活动文档走」的派生（resourceFocusPath 等）只吃这个 ref。
   */
  const activeDocumentPath = ref<string | undefined>(workspace.activePath);

  /** 标签页（文档集合）变更 → 活动文档可能已变 ⇒ 重绑 + 刷新文档态派生 */
  workspace.subscribe(() => {
    activeDocumentPath.value = workspace.activePath;
    bindActive(workspace.activeDocument);
    documentPaths.value = workspace.documents.map((d) => d.path);
    documentKinds.value = new Map(
      workspace.documents.map((d) => [d.path, d.kind]),
    );
    documentDirty.value = new Set(workspace.dirtyPaths);
  });

  /**
   * 切换标签：重绑到该文档（内容未加载时先落活动位，视图面走加载态）。
   *
   * 同时**同步 `selectedColumnId` 到该文档的 entry 列**：时间线/节点图/步骤图都按
   * `selectedColumnId` 在**当前 `story`** 里找列（`StoryTimeline:34`
   * `props.story.columns.find(c => c.id === props.columnId)`）。
   * 切标签只换了 `story`（单列文档）却让 `selectedColumnId` 停在**上一个文档的列** ⇒
   * 在新 `story` 里找不到该列 ⇒ **时间线空白**（首次点 tab 空白、再点一次就好——
   * 因为上一次的 `selectedColumnId` 恰好已等于目标列）。
   * 故事文档的 entry 就是它的列 id ⇒ 这里按不变量同步，而非记一份映射表。
   */
  function selectDocument(path: string): void {
    workspace.activate(path);
    const columnId = columnIdOfDocument(path);
    if (columnId !== undefined) {
      selectedColumnId.value = columnId;
      // 命令选中态同属"这份文档"——跨文档保留上一份文档的指针只会指向不存在的行
      selectedPointer.value = null;
    }
  }

  /**
   * 关闭文档标签（✕ / 中键）。
   *
   * 脏文档**先确认**（`workspace` 不猜用户意图——canClose 是既有判据）；
   * 关闭后的重绑 / 文档派生刷新由 `workspace.subscribe` 统一处理；
   * 关活动标签 ⇒ 顺延位成为新活动 ⇒ `selectDocument` 同口径同步 `selectedColumnId`
   * （否则它停在**被关列**上，时间线在新活动文档里找不到列 ⇒ 空白）。
   */
  async function closeDocument(path: string): Promise<void> {
    if (!workspace.canClose(path)) {
      const ok = await dialog.askConfirm({
        title: `关闭「${columnIdOfDocument(path) ?? path}」？`,
        message: "该标签有未保存的改动，关闭将丢弃（磁盘仍是上次保存的内容）。",
        danger: true,
      });
      if (!ok) return;
    }
    workspace.close(path);
    if (workspace.activePath !== undefined && workspace.activePath !== path) {
      selectDocument(workspace.activePath);
    }
  }

  /**
   * **按需打开某列的文档**（**单列切片**）。
   *
   * 为什么按需：打开工程时**预开所有列**会让大工程在顶部铺满标签
   * （`Workspace` 容量 50 还会静默截断其余列 —— 见 `columnPaths` 的注释）。
   * 而「列 = 文档」的语义（每个标签持**独立单列会话**，防跨标签覆盖的数据丢失防线）
   * **不需要预开**：用户点到哪一列，就为哪一列建会话。
   *
   * 切片必须与 `applyOpened` 原口径完全一致（`{...tree, entry: id, columns: [列]}`）：
   * 整棵树塞进每个标签会让两标签各持**旧副本**，后保存的覆盖先保存的。
   */
  function openColumnDocument(id: string): void {
    const path = storyDocumentPath(id);
    if (workspace.get(path) !== undefined) return; // 已开：复用（不丢未保存改动）
    const tree = projectTree.value ?? story.value;
    const column = tree.columns.find((c) => c.id === id);
    if (column === undefined) return; // fail-closed：列不存在，不造半个文档
    workspace.open(path, "story", { ...tree, entry: id, columns: [column] });
  }

  /**
   * 工程级操作（新增/删除列）改的是**文件集** ⇒ 各单列文档必须按新树重新切分。
   *
   * 约束：**只重切受影响的文档**，未编辑过的文档保留原会话引用
   * （重建它们会连带丢掉各自的 undo 栈与脏标记 —— 会表现为「改了一列，
   * 另一列的未保存改动消失」）。判定用「脏或内容有别于新树」。
   */
  function redistributeDocuments(tree: Story): void {
    const byId = new Map(tree.columns.map((column) => [column.id, column]));
    // 删掉的列 ⇒ 关掉对应文档（脏文档不静默丢：留在标签栏等用户处理）
    for (const path of [...documentPaths.value]) {
      const columnId = columnIdOfDocument(path);
      if (columnId === undefined || !byId.has(columnId)) {
        if (workspace.canClose(path)) workspace.close(path);
      }
    }
    // 用 `markSaved` 换引用而非 `commit`：`commit` 会压一个 undo 单元，
    // 那样"新增列"会给**每个**未编辑文档各记一条假历史（撤销键会出现一堆噪声）。
    // 该文档本就干净 ⇒ 换基线等价于「无变更」，不产生历史是正确语义。
    for (const column of tree.columns) {
      const path = storyDocumentPath(column.id);
      const doc = workspace.get(path);
      // **未打开的列不主动开**：工程级操作（增删列）只负责让
      // **已打开**的文档反映新树。用户从章节树点到新列时 `selectColumn` 会为它建会话。
      // 否则一次「新增一列」会把**所有没开过的列**铺成标签。
      if (doc === undefined) continue;
      if (doc.session.dirty) continue; // 保住未保存改动与历史
      workspace.replaceClean(path, {
        ...tree,
        entry: column.id,
        columns: [column],
      });
    }
    documentPaths.value = tree.columns.map((column) =>
      storyDocumentPath(column.id),
    );
    documentDirty.value = new Set(workspace.dirtyPaths);
  }

  return {
    workspace,
    story: story as ShallowRef<Story>,
    undoDepth,
    redoDepth,
    dirty,
    selectedColumnId,
    selectedPointer,
    documentPaths,
    documentKinds,
    documentDirty,
    activeDocumentPath,
    getSession,
    bindActive,
    attachSession,
    selectDocument,
    closeDocument,
    openColumnDocument,
    redistributeDocuments,
  };
}

export type ProjectFiles = ReturnType<typeof useProjectFiles>;
