/**
 * JSON Pointer（RFC 6901）读取与不可变树编辑：沿路径克隆（结构共享），
 * 未命中路径 fail-closed 返回 null——编辑器映射器只做纯函数（D1）。
 * 锚点: editor-is-pure-mapper
 */

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
