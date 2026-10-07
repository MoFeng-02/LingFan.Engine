/**
 * 视图偏好外置：列分组 / 折叠 = **UI 侧元数据**。
 *
 * 为什么不在故事里：**列序 = 文件路径码元序**是叙事语义，用存储层目录分组会隐式改写它
 * （组内顺序、跨组顺序全变）；归类是**作者视图偏好**，不是故事语义（编辑器只读写故事树）。
 * 因此本模块三条约束：
 * 1. **永不接受 `Story`**——只收 `readonly string[] columnIds`，结构上不可能改故事树；
 * 2. 不产生 undo 单元、不影响 `dirty`、不出现在故事 JSON / 文本投影 / 写回文件集里；
 * 3. 平台 API（localStorage）由宿主注入（`createColumnGroupingStore`），**本模块零 I/O**。
 *
 */

/** 一个分组；`columns` 是**成员集合**——展示序恒按 `columnIds` 重排（见 `layoutColumns`），故不承载顺序语义 */
export interface ColumnGroup {
  id: string;
  name: string;
  columns: string[];
}

/** 持久化形态：版本化（结构演进靠 `version` 判定；顶层不符一律降级为空视图） */
export interface ColumnGroupingView {
  version: 1;
  groups: ColumnGroup[];
  /** 已折叠的分组 id（同样是视图态，不入故事） */
  collapsed: string[];
}

/** 渲染布局：`groups` 只承载分区与折叠，`ungrouped` 是未归类列的**码元序**投影 */
export interface GroupedLayout {
  groups: {
    id: string;
    name: string;
    collapsed: boolean;
    columns: string[];
  }[];
  ungrouped: string[];
}

export function emptyGroupingView(): ColumnGroupingView {
  return { version: 1, groups: [], collapsed: [] };
}

/**
 * 解析存储值（接受字符串或已解析值）。
 * 顶层形状 / `version` 不符 → **空视图**；逐条目坏项**跳过**（不因一个坏组丢整份缓存）。
 * 重复归属按**首次归属优先**归一（后到者丢弃），未知分组 id 的折叠项丢弃。
 */
export function parseGroupingView(raw: unknown): ColumnGroupingView {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return emptyGroupingView(); // 坏 JSON = 忽略缓存
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return emptyGroupingView();
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.groups)) {
    return emptyGroupingView();
  }

  const groups: ColumnGroup[] = [];
  const seenGroupIds = new Set<string>();
  const assigned = new Set<string>();
  for (const entry of record.groups) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const group = entry as Record<string, unknown>;
    const id = group.id;
    if (typeof id !== "string" || id === "" || seenGroupIds.has(id)) continue;
    const columns: string[] = [];
    if (Array.isArray(group.columns)) {
      for (const member of group.columns) {
        if (typeof member !== "string" || member === "") continue;
        if (assigned.has(member)) continue;
        assigned.add(member);
        columns.push(member);
      }
    }
    seenGroupIds.add(id);
    groups.push({
      id,
      name:
        typeof group.name === "string" && group.name !== "" ? group.name : id,
      columns,
    });
  }

  const collapsed: string[] = [];
  if (Array.isArray(record.collapsed)) {
    for (const id of record.collapsed) {
      if (typeof id !== "string" || !seenGroupIds.has(id)) continue;
      if (!collapsed.includes(id)) collapsed.push(id);
    }
  }
  return { version: 1, groups, collapsed };
}

/** 规范形序列化（字段序固定 ⇒ 字节稳定，便于断言与差量） */
export function serializeGroupingView(view: ColumnGroupingView): string {
  return JSON.stringify({
    version: 1,
    groups: view.groups.map((group) => ({
      id: group.id,
      name: group.name,
      columns: [...group.columns],
    })),
    collapsed: [...view.collapsed],
  });
}

/**
 * 裁剪悬空成员（列被删/改名后调用）；**空组保留**——作者可能先建组再收列。
 * 无悬空时**原引用返回**（调用方可据此跳过落盘）。
 */
export function pruneGroupingView(
  view: ColumnGroupingView,
  columnIds: readonly string[],
): ColumnGroupingView {
  const known = new Set(columnIds);
  let dropped = false;
  const groups = view.groups.map((group) => {
    const columns = group.columns.filter((id) => known.has(id));
    if (columns.length === group.columns.length) return group;
    dropped = true;
    return { ...group, columns };
  });
  return dropped
    ? { version: 1, groups, collapsed: [...view.collapsed] }
    : view;
}

/**
 * 渲染布局：**展示序恒按 `columnIds`（= 列序）重排**——分组只做分区与折叠，
 * 永不改变列序；`groups` 为空时 `ungrouped` 即原列序（视图与平铺完全一致）。
 */
export function layoutColumns(
  view: ColumnGroupingView,
  columnIds: readonly string[],
): GroupedLayout {
  const pruned = pruneGroupingView(view, columnIds);
  const memberOf = new Map<string, string>();
  for (const group of pruned.groups) {
    for (const id of group.columns) {
      if (!memberOf.has(id)) memberOf.set(id, group.id);
    }
  }
  return {
    groups: pruned.groups.map((group) => ({
      id: group.id,
      name: group.name,
      collapsed: pruned.collapsed.includes(group.id),
      columns: columnIds.filter((id) => memberOf.get(id) === group.id),
    })),
    ungrouped: columnIds.filter((id) => !memberOf.has(id)),
  };
}

/** 新建分组：id = `group-N`（避撞），名字留空回退「新分组」 */
export function addGroup(
  view: ColumnGroupingView,
  name: string,
): ColumnGroupingView {
  const used = new Set(view.groups.map((group) => group.id));
  let index = 1;
  while (used.has(`group-${index}`)) index += 1;
  return {
    version: 1,
    groups: [
      ...view.groups,
      {
        id: `group-${index}`,
        name: name.trim() === "" ? "新分组" : name,
        columns: [],
      },
    ],
    collapsed: [...view.collapsed],
  };
}

/** 重命名分组；分组不存在或名字为空 → 原引用返回（无变化，调用方可据此跳过落盘） */
export function renameGroup(
  view: ColumnGroupingView,
  groupId: string,
  name: string,
): ColumnGroupingView {
  if (name === "") return view;
  if (!view.groups.some((group) => group.id === groupId)) return view;
  return {
    version: 1,
    groups: view.groups.map((group) =>
      group.id === groupId ? { ...group, name } : group,
    ),
    collapsed: [...view.collapsed],
  };
}

/** 删除分组：组内列回到「未归类」（**不删列**），折叠态一并清掉 */
export function removeGroup(
  view: ColumnGroupingView,
  groupId: string,
): ColumnGroupingView {
  if (!view.groups.some((group) => group.id === groupId)) return view;
  return {
    version: 1,
    groups: view.groups.filter((group) => group.id !== groupId),
    collapsed: view.collapsed.filter((id) => id !== groupId),
  };
}

/**
 * 归属变更：`null` = 移出分组（回「未归类」）。
 * **未知分组 id → 原引用返回**（fail-closed：不静默把列改成未归类）；已在目标分组 → 无变化。
 */
export function assignColumn(
  view: ColumnGroupingView,
  columnId: string,
  groupId: string | null,
): ColumnGroupingView {
  if (groupId !== null && !view.groups.some((group) => group.id === groupId)) {
    return view;
  }
  const current =
    view.groups.find((group) => group.columns.includes(columnId))?.id ?? null;
  if (current === groupId) return view;
  const stripped = view.groups.map((group) => ({
    ...group,
    columns: group.columns.filter((id) => id !== columnId),
  }));
  return {
    version: 1,
    groups:
      groupId === null
        ? stripped
        : stripped.map((group) =>
            group.id === groupId
              ? { ...group, columns: [...group.columns, columnId] }
              : group,
          ),
    collapsed: [...view.collapsed],
  };
}

/** 列改名：成员 id 同步（`to` 已属别处则丢弃本次重复 = 首次归属优先） */
export function renameColumnMember(
  view: ColumnGroupingView,
  from: string,
  to: string,
): ColumnGroupingView {
  if (from === to) return view;
  if (!view.groups.some((group) => group.columns.includes(from))) return view;
  const seen = new Set<string>();
  return {
    version: 1,
    groups: view.groups.map((group) => {
      const columns: string[] = [];
      for (const id of group.columns) {
        const next = id === from ? to : id;
        if (seen.has(next)) continue;
        seen.add(next);
        columns.push(next);
      }
      return { ...group, columns };
    }),
    collapsed: [...view.collapsed],
  };
}

/** 折叠 / 展开；分组不存在 → 原引用返回 */
export function toggleCollapsed(
  view: ColumnGroupingView,
  groupId: string,
): ColumnGroupingView {
  if (!view.groups.some((group) => group.id === groupId)) return view;
  return {
    version: 1,
    groups: [...view.groups],
    collapsed: view.collapsed.includes(groupId)
      ? view.collapsed.filter((id) => id !== groupId)
      : [...view.collapsed, groupId],
  };
}

/**
 * 存储端口（与 `createWebStoragePreferencesPort` 同款「注入式替身」形态）：
 * `localStorage` 由宿主取一次传入，本模块不碰平台 API，测试传内存替身即可。
 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 按 `story.id` 归位（对齐节点图布局的 `lingfan-editor-nodepos:` 先例） */
export const COLUMN_GROUPING_KEY_PREFIX = "lingfan-editor-colgroups:";

/**
 * 分组视图的读写：**任何存储失败都不抛**——读失败 = 空视图（退回平铺），
 * 写失败 = 仅本次会话有效（隐私模式 / 配额满）。编辑器永不因视图偏好而不可用。
 */
export function createColumnGroupingStore(storage: KeyValueStorage | undefined): {
  load(storyId: string): ColumnGroupingView;
  save(storyId: string, view: ColumnGroupingView): void;
} {
  return {
    load(storyId: string): ColumnGroupingView {
      try {
        return parseGroupingView(
          storage?.getItem(COLUMN_GROUPING_KEY_PREFIX + storyId) ?? null,
        );
      } catch {
        return emptyGroupingView();
      }
    },
    save(storyId: string, view: ColumnGroupingView): void {
      try {
        storage?.setItem(
          COLUMN_GROUPING_KEY_PREFIX + storyId,
          serializeGroupingView(view),
        );
      } catch {
        /* 存储不可用（配额 / 隐私模式）= 分组仅本次会话有效 */
      }
    },
  };
}
