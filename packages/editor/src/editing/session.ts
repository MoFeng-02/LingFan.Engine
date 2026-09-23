/**
 * 编辑器会话（06 §一.1 视图族共享中枢）：所有视图经同一 session 提交编辑——
 * 一处改动全视图同步（订阅通知）+ 统一 undo 栈（一次提交 = 一个 undo 单元，
 * 深度可配置）。故事树不可变：提交即整体换引用，视图零 diff 成本。
 * 锚点: unified-undo-across-views
 */

import type { Story } from "@lingfan/engine";
import type { StoryListener, UndoEntry } from "../contracts";

const DEFAULT_UNDO_CAPACITY = 100;

export class EditorSession {
  private current: Story;
  private readonly undoStack: UndoEntry[] = [];
  private readonly redoStack: UndoEntry[] = [];
  private readonly listeners = new Set<StoryListener>();
  private readonly capacity: number;

  constructor(story: Story, options: { undoCapacity?: number } = {}) {
    this.current = story;
    this.capacity = Math.max(1, options.undoCapacity ?? DEFAULT_UNDO_CAPACITY);
  }

  get story(): Story {
    return this.current;
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
   * 提交后清空 redo 尾（新分支时间线，与 03-R2 菜单重选开新时间线同思想）。
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
