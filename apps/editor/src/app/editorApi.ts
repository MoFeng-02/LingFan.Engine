import type { Ref, ShallowRef } from "vue";
import type { SceneType, Story } from "@lingfan-engine/core";
import {
  EditorSession,
  addColumn,
  elementLabel,
  getAtPointer,
  insertAtPointer,
  moveAtPointer,
  nearestCommandPointer,
  planBranchInsertion,
  removeAtPointer,
  removeColumn,
  renameColumn,
  renameColumnMember,
  setAtPointer,
  type ColumnGroupingView,
} from "@lingfan-engine/editor";
import type { EditorApiPort } from "../contracts";
import { storyDocumentPath, type Workspace } from "../domain";

export interface EditorApiDeps {
  /** 活动文档会话（`bindActive` 重绑后取用器恒返回当前值） */
  session: () => EditorSession;
  story: ShallowRef<Story>;
  selectedPointer: Ref<string | null>;
  selectedColumnId: Ref<string>;
  projectTree: Ref<Story | undefined>;
  centerView: Ref<"timeline" | "stage" | "graph" | "step">;
  /**
   * 「揭示」序号：每次 `reveal` 自增，时间线视图据此把选中行滚入视口。
   *
   * 滚动是 DOM 行为，归视图层——本层只发信号，不查文档。
   */
  revealTick: Ref<number>;
  grouping: Ref<ColumnGroupingView>;
  workspace: Workspace;
  openColumnDocument: (id: string) => void;
  selectDocument: (path: string) => void;
  redistributeDocuments: (tree: Story) => void;
  commitGrouping: (next: ColumnGroupingView) => void;
  syncGroupingColumns: () => void;
}

/** 编辑 API：provide 给全部视图（FieldRow/时间线/列侧栏共用一套会话提交） */
export function createEditorApi(deps: EditorApiDeps): EditorApiPort {
  const {
    session,
    story,
    selectedPointer,
    selectedColumnId,
    projectTree,
    centerView,
    revealTick,
    grouping,
    workspace,
    openColumnDocument,
    selectDocument,
    redistributeDocuments,
    commitGrouping,
    syncGroupingColumns,
  } = deps;

  const api: EditorApiPort = {
    /** 字段/负载写入（pointer 指向字段值） */
    update(pointer: string, value: unknown): void {
      session().apply(`改 ${pointer}`, (s) => setAtPointer(s, pointer, value));
    },
    /** 删除可选字段（置空即删） */
    removeField(pointer: string): void {
      session().apply(`清 ${pointer}`, (s) => removeAtPointer(s, pointer));
    },
    /** 向数组容器插入命令或元素草稿（pointer 指向数组；缺省追加末尾；undo 标签按形态命名） */
    insertCommand(pointer: string, command: Record<string, unknown>): void {
      const what =
        typeof command.op === "string"
          ? command.op
          : `元素 ${String(command.type ?? "?")}`;
      session().apply(`插入 ${what}`, (s) => {
        const list = getAtPointer(s, pointer);
        const index = Array.isArray(list) ? list.length : 0;
        return insertAtPointer(s, pointer, index, command);
      });
    },
    removeCommand(pointer: string): void {
      session().apply(`删除 ${pointer}`, (s) => {
        const next = removeAtPointer(s, pointer);
        if (
          next !== null &&
          selectedPointer.value !== null &&
          (selectedPointer.value === pointer ||
            selectedPointer.value.startsWith(`${pointer}/`))
        ) {
          selectedPointer.value = null;
        }
        return next;
      });
    },
    moveCommand(pointer: string, delta: number): void {
      session().apply(`移动 ${pointer}`, (s) => {
        const segments = pointer.split("/");
        const index = Number(segments[segments.length - 1]);
        if (Number.isNaN(index)) return null;
        return moveAtPointer(s, pointer, index + delta);
      });
    },
    /**
     * 就地选中（**纯选中，不改视图**）。
     *
     * 职责拆分：`select()` 只做「就地选中」；「切回时间线并滚动到目标行」
     *   （定位体验）独立为 `reveal`。
     *   两者混在一起时，舞台视图复用 `select()` ⇒ `pointerdown` 瞬间被切视图 ⇒
     *   舞台因 `v-else-if` **卸载**，拖拽的 `onMove`/`onUp` 还挂在 window 上但组件已死
     *   ⇒ **拖拽完全不可用**。⇒ 选中归 `select`，定位归 `reveal`。
     */
    select(pointer: string | null): void {
      // 诊断/引用的指针是字段级——归一到最近的命令祖先，行高亮与属性面板才有锚点
      selectedPointer.value =
        pointer === null ? null : nearestCommandPointer(story.value, pointer);
      const columnPointer = pointer?.match(/^\/columns\/(\d+)/);
      if (columnPointer !== null && columnPointer !== undefined) {
        const column = getAtPointer(story.value, columnPointer[0]) as
          { id?: string } | undefined;
        if (typeof column?.id === "string") selectedColumnId.value = column.id;
      }
    },
    /**
     * 定位揭示（**选中 + 切回时间线 + 递增揭示序号**）。
     *
     * 存在理由：点了诊断必须「看得见」——长列表/其他视图下目标行在视口外，
     * 用户感知就是「点了没反应」。**只有诊断面板与步骤图需要它**。
     * 真正的滚动由时间线视图监听 `revealTick` 完成（滚动是 DOM 行为，不属本层）。
     */
    reveal(pointer: string): void {
      api.select(pointer);
      centerView.value = "timeline";
      revealTick.value += 1;
    },
    /**
     * 选中列：**同时把命令指针指向列本身**（`/columns/<i>`）——
     * 舞台视图按 pointer 判定所属 scene 列；只设 selectedColumnId 会让舞台永远提示「未选中列」。
     */
    selectColumn(id: string): void {
      // 列 = 文档（单列原子文件不变量）⇒ **选列即切标签**：
      // 标签页与列树是同一份工程结构的两个面（一个按打开序、一个按列序），
      // 两者若不联动就会出现「选了一列但标签没切」的分裂。
      const path = storyDocumentPath(id);
      // **按需打开**：工程打开时不预开所有列（否则大工程会铺满标签）。
      // 点到未开的列 ⇒ 先为它建会话，再切过去；否则 `selectedColumnId` 会指向一个
      // 没有文档的列，时间线 / 属性面板都拿不到内容。
      openColumnDocument(id);
      if (workspace.get(path) !== undefined) {
        selectDocument(path);
      }
      selectedColumnId.value = id;
      const index = (projectTree.value ?? story.value).columns.findIndex(
        (c) => c.id === id,
      );
      selectedPointer.value = index >= 0 ? `/columns/${index}` : null;
    },
    renameColumn(from: string, to: string): void {
      const changed = session().apply(`重命名 ${from} → ${to}`, (s) =>
        renameColumn(s, from, to),
      );
      // 分组是视图元数据，成员 id 随列改名同步（失败不影响故事编辑本身）
      if (changed) commitGrouping(renameColumnMember(grouping.value, from, to));
    },
    addColumn(
      kind: "flow" | "scene",
      hint?: string,
      /** 运行语义轴（正交）；缺省/game 不写字段 —— 判据在 `@lingfan-engine/editor` 的 addColumn */
      type?: SceneType,
    ): void {
      // 新增列是**工程级**操作（改的是文件集，不是某个文件的内容）。
      // 单列文档上直接跑 `addColumn` 会产出「一个文档两列」——违反「一文档 = 一列」不变量，
      // 且保存时 `serializeColumnDocument` 会 fail-closed（恰是它兜住了，但用户会看到莫名错误）。
      // 正解：把操作施加在**整工程树**上，再把结果按列重新切分回各文档。
      const tree = projectTree.value;
      if (tree === undefined) {
        session().apply(`新增${kind === "flow" ? "流程" : "场景"}列`, (s) => {
          const result = addColumn(s, { kind, hint, type });
          selectedColumnId.value = result.id;
          return result.story;
        });
        return;
      }
      const result = addColumn(tree, { kind, hint, type });
      projectTree.value = result.story;
      redistributeDocuments(result.story);
      // 新列的文档**还没被打开过**（按需打开）⇒ 必须先建会话再切。
      //    不用 `this.selectColumn`：本对象的方法会被解构调用（`api.selectColumn`），
      //    `this` 不可靠；两行内联反而没有隐式依赖。
      openColumnDocument(result.id);
      selectDocument(storyDocumentPath(result.id));
    },
    removeColumn(id: string): void {
      // 同 addColumn：工程级操作（删的是文件）
      const tree = projectTree.value;
      if (tree === undefined) {
        if (session().apply(`删除列 ${id}`, (s) => removeColumn(s, id))) {
          syncGroupingColumns();
        }
        return;
      }
      const next = removeColumn(tree, id);
      if (next === null) return; // 未命中（列不存在）= 无事发生，不产出半个新树
      projectTree.value = next;
      redistributeDocuments(next);
      syncGroupingColumns();
    },
    /**
     * 组件拖入：元素**落点创建**（`parentPointer` = 容器元素指针 → 进 `children`，
     * 缺数组就在同一次提交里补齐）。**一次拖入 = 一个 undo 单元**；顶级创建后选中新元素
     * （属性面板立即可改），嵌套创建不改变选中（舞台视图不渲染 children）。
     */
    insertElement(
      columnPointer: string,
      element: Record<string, unknown>,
      parentPointer?: string,
    ): void {
      const type = String(element.type ?? "");
      const target =
        parentPointer === undefined
          ? `${columnPointer}/elements`
          : `${parentPointer}/children`;
      const existing = getAtPointer(story.value, target);
      const appendedAt = Array.isArray(existing) ? existing.length : 0;
      const applied = session().apply(`拖入元素 ${elementLabel(type)}`, (s) => {
        const list = getAtPointer(s, target);
        const index = Array.isArray(list) ? list.length : 0;
        const base = Array.isArray(list) ? s : setAtPointer(s, target, []);
        return insertAtPointer(base, target, index, element);
      });
      if (!applied || parentPointer !== undefined) return;
      selectedPointer.value = `${target}/${appendedAt}`;
      const column = getAtPointer(story.value, columnPointer) as
        { id?: string } | undefined;
      if (typeof column?.id === "string") selectedColumnId.value = column.id;
    },
    /**
     * 节点图连线：从 `fromColumnId` 拉线到 `toColumnId` 建分支——
     * 源列最后一个 `menu` → 追加选项；否则 → 末尾追加 `jump`。
     * 语义判定在纯函数 `planBranchInsertion`（非法组合返回 false，调用方 fail-closed 提示）；
     * **一次拉线 = 一个 undo 单元**。落库后新 jump/选项由既有诊断面校验（missing-target 等）。
     */
    connectBranch(
      fromColumnId: string,
      toColumnId: string,
      optionText?: string,
    ): boolean {
      return session().apply(`连分支 ${fromColumnId} → ${toColumnId}`, (s) => {
        const index = s.columns.findIndex((c) => c.id === fromColumnId);
        if (index < 0) return null;
        const plan = planBranchInsertion(
          s.columns[index],
          toColumnId,
          optionText,
        );
        if (plan === null) return null;
        const value =
          plan.kind === "jump"
            ? { op: "jump", target: plan.target }
            : { text: plan.text ?? "新选项", target: plan.target };
        return insertAtPointer(
          s,
          `/columns/${index}/${plan.containerPointer}`,
          plan.index,
          value,
        );
      });
    },
    replaceAll(next: Story, label: string): void {
      session().commit(label, next);
      selectedPointer.value = null;
      selectedColumnId.value = next.entry;
    },
  };
  return api;
}
