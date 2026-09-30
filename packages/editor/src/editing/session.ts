/**
 * 编辑器会话（视图族共享中枢）：所有视图经同一 session 提交编辑——
 * 一处改动全视图同步（订阅通知）+ 统一 undo 栈（一次提交 = 一个 undo 单元，
 * 深度可配置）。故事树不可变：提交即整体换引用，视图零 diff 成本。
 * 统一 undo：跨视图同步、一次提交一个单元。
 */

import type { Story } from "@lingfan/engine";
import type { StoryListener, UndoEntry } from "../contracts";

const DEFAULT_UNDO_CAPACITY = 100;

export class EditorSession {
  private current: Story;
  /** 已保存基线（引用比较：commit 恒换引用、undo 恢复原引用 → 撤销回已保存态即干净） */
  private saved: Story;
  private readonly undoStack: UndoEntry[] = [];
  private readonly redoStack: UndoEntry[] = [];
  private readonly listeners = new Set<StoryListener>();
  private readonly capacity: number;

  constructor(story: Story, options: { undoCapacity?: number } = {}) {
    this.current = story;
    this.saved = story;
    this.capacity = Math.max(1, options.undoCapacity ?? DEFAULT_UNDO_CAPACITY);
  }

  get story(): Story {
    return this.current;
  }

  /**
   * 有未保存更改（09-16）。引用比较：唯一代价是「内容相同的不同引用」会多亮一次按钮，
   * **不会漏报**未保存（安全方向正确）；深比较每次渲染全树遍历，不划算。
   */
  get dirty(): boolean {
    return this.current !== this.saved;
  }

  /**
   * 保存成功：把基线钉到**实际写出的那个引用**（不是当前引用）——
   * 保存期间用户又编辑时，`current !== reference` → 仍 dirty，不会误清。
   */
  markSaved(reference: Story = this.current): void {
    if (this.saved === reference) return;
    this.saved = reference;
    this.notify();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  get redoDepth(): number {
    return this.redoStack.length;
  }

  /**
   * 提交一次编辑（一个 undo 单元）：同引用提交为 no-op（无变更不产生历史噪声）。
   * 提交后清空 redo 尾（新分支时间线，与菜单重选开新时间线同思想）。
   */
  commit(label: string, next: Story): void {
    if (next === this.current) return;
    this.undoStack.push({ label, before: this.current, after: next });
    if (this.undoStack.length > this.capacity) this.undoStack.shift();
    this.redoStack.length = 0;
    this.current = next;
    this.notify();
  }

  /** 由编辑函数派生新故事并提交；编辑函数返回 null = 未命中，不产生历史单元 */
  apply(label: string, edit: (story: Story) => Story | null): boolean {
    const next = edit(this.current);
    if (next === null) return false;
    this.commit(label, next);
    return true;
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (entry === undefined) return false;
    this.redoStack.push(entry);
    this.current = entry.before;
    this.notify();
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (entry === undefined) return false;
    this.undoStack.push(entry);
    this.current = entry.after;
    this.notify();
    return true;
  }

  /** 订阅故事变更（视图同步接缝）；返回退订函数 */
  subscribe(listener: StoryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.current);
  }
}
