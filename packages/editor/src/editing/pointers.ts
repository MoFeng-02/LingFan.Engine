/**
 * JSON Pointer（RFC 6901）读取与不可变树编辑：沿路径克隆（结构共享），
 * 未命中路径 fail-closed 返回 null——编辑器映射器只做纯函数。
 */

import { describeForm } from "../schema";
import { BUILTIN_OP_SURFACE, type OpSurface } from "../schema";

type PathSegment = string | number;

/** 组装 JSON Pointer（段转义 ~ 与 /） */
export function buildPointer(segments: readonly PathSegment[]): string {
  if (segments.length === 0) return "";
  return (
    "/" +
    segments
      .map((segment) =>
        String(segment).replaceAll("~", "~0").replaceAll("/", "~1"),
      )
      .join("/")
  );
}

export function parsePointer(pointer: string): PathSegment[] {
  if (pointer === "" || !pointer.startsWith("/")) return [];
  return pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

/** 读取指针处值；指针非法或路径未命中返回 undefined */
export function getAtPointer(root: unknown, pointer: string): unknown {
  let current: unknown = root;
  for (const segment of parsePointer(pointer)) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
      continue;
    }
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function shallowClone(
  node: unknown,
): Record<string, unknown> | unknown[] | undefined {
  if (Array.isArray(node)) return node.slice();
  if (node !== null && typeof node === "object") {
    return { ...(node as Record<string, unknown>) };
  }
  return undefined;
}

/**
 * 沿 parentSegments 克隆到目标父节点（结构共享），对父克隆应用 apply。
 * apply 返回 false = 未命中（fail-closed）；返回 undefined = 路径未命中。
 */
function editAt(
  root: unknown,
  parentSegments: readonly PathSegment[],
  key: PathSegment,
  apply: (parentClone: unknown, key: PathSegment) => boolean,
): unknown | undefined {
  if (parentSegments.length === 0) {
    const parentClone = shallowClone(root);
    if (parentClone === undefined) return undefined;
    return apply(parentClone, key) ? parentClone : undefined;
  }
  const [head, ...rest] = parentSegments;
  if (typeof head === "number") {
    if (!Array.isArray(root) || head < 0 || head >= root.length)
      return undefined;
    const child = editAt(root[head], rest, key, apply);
    if (child === undefined) return undefined;
    const clone = root.slice();
    clone[head] = child;
    return clone;
  }
  if (root === null || typeof root !== "object") return undefined;
  const record = root as Record<string, unknown>;
  if (!(head in record)) return undefined;
  const child = editAt(record[head], rest, key, apply);
  if (child === undefined) return undefined;
  return { ...record, [head]: child };
}

function keyOf(
  parent: unknown,
  key: PathSegment,
): { get(): unknown; set(value: unknown): boolean } | null {
  if (typeof key === "number") {
    if (!Array.isArray(parent)) return null;
    return {
      get: () => parent[key],
      set: (value) => {
        if (key < 0 || key > parent.length) return false;
        parent[key] = value;
        return true;
      },
    };
  }
  if (parent === null || typeof parent !== "object") return null;
  const record = parent as Record<string, unknown>;
  return {
    get: () => record[key],
    set: (value) => {
      record[key] = value;
      return true;
    },
  };
}

/** 写入指针处值（不可变；数组索引允许 == length 追加）；路径未命中返回 null */
export function setAtPointer<T>(
  root: T,
  pointer: string,
  value: unknown,
): T | null {
  const segments = parsePointer(pointer);
  if (segments.length === 0) return null;
  const key = segments[segments.length - 1]!;
  const next = editAt(root, segments.slice(0, -1), key, (parent, k) => {
    const slot = keyOf(parent, k);
    return slot !== null && slot.set(value);
  });
  return next === undefined ? null : (next as T);
}

/** 移除指针处值（数组按索引删，对象删键）；不可变；未命中返回 null */
export function removeAtPointer<T>(root: T, pointer: string): T | null {
  const segments = parsePointer(pointer);
  if (segments.length === 0) return null;
  const key = segments[segments.length - 1]!;
  const next = editAt(root, segments.slice(0, -1), key, (parent, k) => {
    if (typeof k === "number") {
      if (!Array.isArray(parent) || k < 0 || k >= parent.length) return false;
      parent.splice(k, 1);
      return true;
    }
    if (parent === null || typeof parent !== "object") return false;
    if (!(k in (parent as Record<string, unknown>))) return false;
    delete (parent as Record<string, unknown>)[k];
    return true;
  });
  return next === undefined ? null : (next as T);
}

/** 数组插入：pointer 指向数组，index 为插入位；不可变；未命中返回 null */
export function insertAtPointer<T>(
  root: T,
  pointer: string,
  index: number,
  value: unknown,
): T | null {
  const segments = parsePointer(pointer);
  if (segments.length === 0) return null;
  const key = segments[segments.length - 1]!;
  const next = editAt(root, segments.slice(0, -1), key, (parent, k) => {
    const slot = keyOf(parent, k);
    if (slot === null || !Array.isArray(slot.get())) return false;
    const list = slot.get() as unknown[];
    if (index < 0 || index > list.length) return false;
    const copy = list.slice();
    copy.splice(index, 0, value);
    return slot.set(copy);
  });
  return next === undefined ? null : (next as T);
}

/** 数组元素移动：elementPointer 指向元素，toIndex 为移除后目标位；不可变；未命中返回 null */
export function moveAtPointer<T>(
  root: T,
  elementPointer: string,
  toIndex: number,
): T | null {
  const segments = parsePointer(elementPointer);
  if (segments.length === 0) return null;
  const key = segments[segments.length - 1]!;
  if (typeof key !== "number") return null;
  const next = editAt(root, segments.slice(0, -1), key, (parent, k) => {
    if (!Array.isArray(parent) || typeof k !== "number") return false;
    if (k < 0 || k >= parent.length) return false;
    if (toIndex < 0 || toIndex >= parent.length) return false;
    const [moved] = parent.splice(k, 1);
    parent.splice(toIndex, 0, moved);
    return true;
  });
  return next === undefined ? null : (next as T);
}

function isCommandAt(root: unknown, pointer: string): boolean {
  const node = getAtPointer(root, pointer);
  return (
    node !== null &&
    typeof node === "object" &&
    !Array.isArray(node) &&
    typeof (node as Record<string, unknown>).op === "string"
  );
}

/**
 * 归一到**最近的命令祖先指针**：诊断/引用给出的指针是字段级（精确到
 * 字段），而时间线行选中与属性面板表单都锚在命令指针上——指针不是命令时沿前缀
 * **从长到短**上溯包含它的命令（嵌套块体逐级上溯）；本身已是命令、或无命令祖先
 * （列指针 / 根）→ 原样返回（调用方既有语义不变）。
 */
export function nearestCommandPointer(story: unknown, pointer: string): string {
  if (isCommandAt(story, pointer)) return pointer;
  const segments = parsePointer(pointer);
  for (let i = segments.length - 1; i >= 2; i -= 1) {
    const prefix = buildPointer(segments.slice(0, i));
    if (isCommandAt(story, prefix)) return prefix;
  }
  return pointer;
}

/* ------------------------------------------------------------------ *
 * 选中态语义
 * ------------------------------------------------------------------ */

/** 选中态分类；**除 `unknown-op` 外都不是错误**（列 / 元素 / 数组项都是正常选中） */
export type SelectionKind = "none" | "non-command" | "unknown-op" | "command";

/** 非命令选中的细分（仅供文案取用，不改变 `kind`） */
export type SelectionNodeKind = "column" | "element" | "item" | "other";

export interface SelectionDescription {
  kind: SelectionKind;
  /** `non-command` / `unknown-op` 时有意义 */
  nodeKind?: SelectionNodeKind;
  /** `command` / `unknown-op` 时有意义 */
  opName?: string;
}

/** 按指针形状细分非命令目标：`/columns/<i>` = 列；`…/elements/<j>` = 元素；`…/commands/<j>` = 组内项 */
function selectionNodeKind(pointer: string): SelectionNodeKind {
  const segments = parsePointer(pointer);
  if (segments[0] !== "columns") return "other";
  if (segments.length === 2) return "column";
  if (segments[2] === "elements") return "element";
  if (segments[2] === "commands") return "item";
  return "other";
}

/**
 * 描述「当前选中了什么」——**四态**，而不是「是命令 / 不是命令」两态。
 *
 * **要点**：属性面板**不得**把「选中的是一列」渲染成错误——「所选位置不是命令
 * （op 缺失）——诊断面板有详情」会与**同一时刻**诊断面板显示的「✓ 无诊断」
 * 互相矛盾，且把用户的**正常操作**说成故障。真实语义有四种：
 *
 * | kind | 触发 | 该说什么 |
 * |---|---|---|
 * | `none` | `pointer === null` | 中性引导：选一条命令 |
 * | `non-command` | 指针落在列 / 元素 / 数组项 | **中性陈述**，**不得出现「错误/缺失/诊断」** |
 * | `unknown-op` | 落在命令上，但**无表单描述符** | **真问题**（提诊断、可删除） |
 * | `command` | 正常命令 | 现有表单 |
 *
 * 判定顺序：`null` → `none`；节点是对象且 `op` 为字符串 → 有描述符即 `command`，
 * 否则 `unknown-op`（把操作数也带上，即 `opName`）；其余 → `non-command`。
 * **指针悬空**（`getAtPointer` 未命中）同样归 `non-command` —— fail-soft：面板给
 * 中性文案，**不谎报成错误**（悬空多由撤销后的陈旧选中造成，不属 op 缺失）。
 *
 * `surface` 与 `describeForm` 同口径（缺省 = 内建 op 面）——**不得**在这里换一套
 * op 面，否则会与面板表单的判断打架。
 */
export function describeSelection(
  story: unknown,
  pointer: string | null,
  surface: OpSurface = BUILTIN_OP_SURFACE,
): SelectionDescription {
  if (pointer === null) return { kind: "none" };
  const nodeKind = selectionNodeKind(pointer);
  const node = getAtPointer(story, pointer);
  if (
    node !== null &&
    typeof node === "object" &&
    !Array.isArray(node) &&
    typeof (node as Record<string, unknown>).op === "string"
  ) {
    const opName = (node as Record<string, unknown>).op as string;
    return describeForm(opName, surface) === undefined
      ? { kind: "unknown-op", nodeKind, opName }
      : { kind: "command", nodeKind, opName };
  }
  return { kind: "non-command", nodeKind };
}
