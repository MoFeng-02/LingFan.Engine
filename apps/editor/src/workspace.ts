/**
 * 多文档会话模型（资源管理器的中枢）：**一个资源 = 一个文档 = 一个 `EditorSession`**。
 *
 * 为何需要（不是"锦上添花"，是数据丢失的前置条件）：单文档形态下编辑器持有
 * 「整工程一个 `Story` + 一个 `dirty` + 一个 undo 栈」，写回走 `serializeProject`
 * 全量重算期望文件集。一旦引入多标签，**两个标签各持一份旧 `Story`**，后保存的
 * 会拿自己的旧副本覆盖先保存的 ⇒ 丢改动。本模块把「持有」这件事按文档切开，
 * 让每个文档的脏标记与撤销历史各自独立。
 *
 * 纯逻辑 + 注入式（不碰文件系统、不碰 Vue）：可测、可被浏览器与本地两种形态共用。
 * 存储形状刻意对齐既有先例（`KeyValueStorage` 注入式、失败静默降级）。
 *
 * **写回不在本模块职责内**：本模块只回答「哪些文档脏了、各自的树是什么」；
 * 组装整工程期望集是调用方（宿主）的事——它才持有打开基线与写回端口。
 */

import type { Story } from "@lingfan/engine";
import { EditorSession } from "@lingfan/editor";

/** 文档身份：**资源根内的逻辑路径**（`/` 分隔，如 `Stories/tavern.json`）——唯一且稳定 */
export type DocumentPath = string;

/** 单个文档的宿主状态（一棵树 + 一个会话；视图族经它提交编辑） */
export interface EditorDocument {
  /** 逻辑路径 = 身份（不可变） */
  readonly path: DocumentPath;
  /** 该文档所属的资源种类（决定用哪个视图；纯数据，视图映射由宿主持有） */
  readonly kind: string;
  /** 会话中枢：提交即换引用，undo/redo/dirty 各自独立 */
  readonly session: EditorSession;
}

/** 打开文档时的初始载荷 */
export interface DocumentSeed {
  readonly path: DocumentPath;
  readonly kind: string;
  readonly story: Story;
}

export interface WorkspaceSnapshot {
  readonly documents: readonly EditorDocument[];
  /** 当前活动文档路径；无文档 = `undefined` */
  readonly activePath: DocumentPath | undefined;
}

/** 会话变更通知（视图族与宿主共用一条接缝，形状对齐既有 `StoryListener`） */
export type DocumentsListener = (snapshot: WorkspaceSnapshot) => void;

/**
 * 文档集合的纯状态机：**打开 / 激活 / 关闭**，不碰任何 IO。
 *
 * 不变量（三条，任一被破坏即为实现缺陷）：
 * ① 路径唯一——重复打开同一路径返回既有文档，**不新建**（否则同一文件两个 undo 栈会互相覆盖）；
 * ② 脏文档**不可静默丢弃**——关闭脏文档由调用方先确认（模块只如实报告 `canClose`）；
 * ③ 活动文档恒存在——关闭最后文档时 `activePath` 变 `undefined`，不留悬空引用。
 */
export class Workspace {
  private readonly docs = new Map<DocumentPath, EditorDocument>();
  private active: DocumentPath | undefined;
  private readonly listeners = new Set<DocumentsListener>();

  constructor(seeds: readonly DocumentSeed[] = [], private readonly capacity = 50) {
    for (const seed of seeds) this.open(seed.path, seed.kind, seed.story);
  }

  get documents(): readonly EditorDocument[] {
    // 稳定序 = 打开序（Map 保插入序）；标签栏顺序由宿主决定，不在此处隐式排序
    return [...this.docs.values()];
  }

  get activePath(): DocumentPath | undefined {
    return this.active;
  }

  /** 活动文档；无活动文档 = `undefined`（视图面据此走空态） */
  get activeDocument(): EditorDocument | undefined {
    return this.active === undefined ? undefined : this.docs.get(this.active);
  }

  get(path: DocumentPath): EditorDocument | undefined {
    return this.docs.get(path);
  }

  /** 全部脏文档（状态栏与关闭确认共用一个口径） */
  get dirtyPaths(): DocumentPath[] {
    return this.documents
      .filter((doc) => doc.session.dirty)
      .map((doc) => doc.path);
  }

  get dirtyCount(): number {
    return this.dirtyPaths.length;
  }

  /**
   * 打开文档：已存在则**只激活**（不新建、不丢未保存改动）。
   * 容量上限：超出时挤掉**最早且干净**的文档；全脏则**拒绝并报出**（fail-closed：
   * 宁可打不开，也不静默丢弃作者的未保存改动）。
   */
  open(path: DocumentPath, kind: string, story: Story): EditorDocument {
    const existing = this.docs.get(path);
    if (existing !== undefined) {
      this.active = path;
      this.notify();
      return existing;
    }
    if (this.docs.size >= this.capacity) {
      const evictable = this.documents.find((doc) => !doc.session.dirty);
      if (evictable === undefined) {
        throw new Error(
          `打开的文档已达上限 ${this.capacity}，且全部有未保存改动——请先保存或关闭部分文档`,
        );
      }
      this.docs.delete(evictable.path);
      if (this.active === evictable.path) this.active = undefined;
    }
    const doc: EditorDocument = { path, kind, session: new EditorSession(story) };
    this.docs.set(path, doc);
    this.active = path;
    this.notify();
    return doc;
  }

  /**
   * 激活文档。**不要求该文档已打开**——宿主可以先切标签再懒加载内容
   * （活动路径先落位、内容后到，视图面走加载态）。
   */
  activate(path: DocumentPath): void {
    if (this.active === path) return;
    this.active = path;
    this.notify();
  }

  /**
   * 关闭文档。**调用方须先自行确认脏文档**（本模块不弹窗、不猜用户意图）。
   * 关闭活动文档时，活动位顺延到打开序里的下一个，没有则 `undefined`。
   */
  close(path: DocumentPath): void {
    const doc = this.docs.get(path);
    if (doc === undefined) return;
    // 顺延位必须在删除**之前**取——删除后该路径已不在键序里。
    const next = this.nextAfter(path);
    this.docs.delete(path);
    if (this.active === path) {
      this.active = next;
    }
    this.notify();
  }

  /** 关闭前是否安全（干净 = 可直接关；脏 = 必须先确认） */
  canClose(path: DocumentPath): boolean {
    const doc = this.docs.get(path);
    return doc !== undefined && !doc.session.dirty;
  }

  /**
   * 换基线（工程结构刷新）：树与已保存基线同时换掉，**不产生 undo 单元**。
   * 脏文档一律拒绝（返回 false）—— 静默丢弃作者改动不可接受。
   */
  replaceClean(path: DocumentPath, story: Story): boolean {
    const doc = this.docs.get(path);
    if (doc === undefined) return false;
    const changed = doc.session.replaceClean(story);
    if (changed) this.notify();
    return changed;
  }

  subscribe(listener: DocumentsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 活动文档顺延位：取「打开序中紧随其后者」，无则退到前一个，都没有则空。
   * 必须在删除该路径**之前**调用。
   */
  private nextAfter(path: DocumentPath): DocumentPath | undefined {
    const paths = [...this.docs.keys()];
    const at = paths.indexOf(path);
    if (at < 0) return undefined;
    return paths[at + 1] ?? paths[at - 1];
  }

  private notify(): void {
    const snapshot: WorkspaceSnapshot = {
      documents: this.documents,
      activePath: this.active,
    };
    for (const listener of this.listeners) listener(snapshot);
  }
}

/**
 * 文档身份推导：资源根内的逻辑路径 ⇄ 列 id。
 *
 * 单一事实源在引擎（`STORIES_DIR` + 列 id 即文件名的不变量，见 `isSafeFileNameSegment`），
 * 本函数只做**路径形态**的读写，不重新发明命名规则。
 */
export function storyDocumentPath(columnId: string): DocumentPath {
  return `Stories/${columnId}.json`;
}

/** 从文档路径取列 id（非故事文件返回 `undefined`，不做后缀形态猜测） */
export function columnIdOfDocument(path: DocumentPath): string | undefined {
  if (!path.startsWith("Stories/") || !path.endsWith(".json")) return undefined;
  const id = path.slice("Stories/".length, path.length - ".json".length);
  return id === "" ? undefined : id;
}
