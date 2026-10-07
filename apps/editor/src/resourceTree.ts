/**
 * 资源树的**纯模型**（资源管理器的树面）：逻辑路径集合 → 可渲染的分组树。
 *
 * 为何是纯函数（不碰 IO、不碰 Vue）：树的分组/排序/标记全是**可测的规则**，
 * 而规则最容易在 UI 里悄悄错掉（一个 `startsWith` 写错就整类资源消失）。
 *
 * 适用范围（只管 `Resources/**` 与编译期/生成型产物，**排除 `Saves/`**）：
 * - `Saves/**` = **运行时产物** ⇒ 树里**灰显**且**不提供视图**（不是隐藏，是明示「不归本编辑器」）；
 * - `src/*.ts` 等代码在**资源根之外** ⇒ 本函数压根收不到（枚举只覆盖资源根内）。
 */

import type { KeyValueStorage } from "@lingfan/editor";

/** 资源种类（决定图标与默认动作；**不是**视图分派的唯一依据） */
export type ResourceKind =
  | "story"
  | "lang"
  | "image"
  | "audio"
  | "video"
  | "manifest"
  | "saves"
  | "other";

/** 树节点：目录 = 有子节点；文件 = 叶子 */
export interface ResourceNode {
  readonly name: string;
  /** 逻辑路径（目录为其下所有文件的公共前缀，末尾带 `/`；文件为完整路径） */
  readonly path: string;
  readonly kind: ResourceKind;
  readonly children: readonly ResourceNode[];
  /** 目录：是否可折叠（根级恒 false——折叠根会把整个树藏没） */
  readonly collapsible: boolean;
  /** 文件：是否只读（如 `Saves/**` 与非故事资源本批不可编辑） */
  readonly readOnly: boolean;
}

const DIR_SUFFIX = "/";

/** 资源种类判定（**按后缀**而非目录名——扩展名才是「用什么打开」的依据） */
export function kindOfPath(path: string): ResourceKind {
  if (path.startsWith("Saves/")) return "saves";
  if (path === "project.json") return "manifest";
  const file = path.slice(path.lastIndexOf("/") + 1);
  const dot = file.indexOf(".");
  // 无点号 = 无后缀（如 `README`）；`.gitignore` 之类点文件已在上游被剔除
  if (dot < 0) return "other";
  // 加密后缀：`.enc` 是**包装**层，真实类型看剥掉它之后的那一层
  // （`main.json.enc` → `json`；`blob.enc` → 无后缀 ⇒ other）
  const stripped = file.slice(0, file.length - 4);
  const effective =
    file.slice(file.length - 4) === ".enc" && stripped.includes(".")
      ? stripped.slice(stripped.lastIndexOf(".") + 1)
      : file.slice(dot + 1);
  if (path.startsWith("Stories/")) {
    return effective === "json" || effective === "story" ? "story" : "other";
  }
  if (path.startsWith("Lang/")) return "lang";
  switch (effective) {
    case "png":
    case "jpg":
    case "jpeg":
    case "webp":
    case "gif":
    case "svg":
      return "image";
    case "mp3":
    case "wav":
    case "ogg":
    case "flac":
      return "audio";
    case "mp4":
    case "webm":
    case "mov":
      return "video";
    default:
      return "other";
  }
}

/**
 * 只读判据：**本批只有 `.story` 有编辑器**；`Saves/` 是运行时产物，
 * 媒体/其他一律只读（不提供编辑）。kind 由 `kindOfPath` 推出，不重复解析路径。
 */
export function isReadOnlyPath(path: string): boolean {
  const kind = kindOfPath(path);
  return kind === "saves" || (kind !== "story" && kind !== "manifest" && kind !== "lang");
}

/**
 * 构建资源树：**目录优先 + 同层文件按名排序**（确定性——同一份文件集必须产出同一棵树）。
 *
 * 排序口径：目录在前、文件在后，各按码元序（与 `assembleProject` 的路径序同族）。
 */
export function buildResourceTree(paths: readonly string[]): ResourceNode[] {
  /**
   * 工作区用**可变**节点，对外暴露的才是 `readonly`（契约只增不改）：
   * 建树本质是「逐个挂子节点」，用 `readonly` 数组反而要在每个 push 处 cast。
   */
  interface MutableNode {
    name: string;
    path: string;
    kind: ResourceKind;
    children: MutableNode[];
    collapsible: boolean;
    readOnly: boolean;
  }

  const roots: MutableNode[] = [];
  /** 目录缓存：键 = 目录逻辑路径（`Lang/`、`Lang/en/`…；根 `""` 不进缓存） */
  const dirCache = new Map<string, MutableNode>();

  /**
   * 取或建目录节点，**自顶向下**建链（先父后子）——
   * 逐级向上递归会把自己注册成自己的父（键与父键相同 ⇒ 自嵌套）。
   */
  const ensureDir = (dirPath: string): MutableNode => {
    const cached = dirCache.get(dirPath);
    if (cached !== undefined) return cached;
    const node: MutableNode = {
      name: nameOf(dirPath),
      path: dirPath,
      kind: "other",
      children: [],
      collapsible: true,
      readOnly: true,
    };
    dirCache.set(dirPath, node);
    const parentPath = parentOf(dirPath);
    // 先确保父存在，再挂自己（父先注册 ⇒ 无自嵌套）
    const parent = parentPath === "" ? null : ensureDir(parentPath);
    if (parent === null) roots.push(node);
    else parent.children.push(node);
    return node;
  };

  for (const path of [...paths].sort(byCodeUnit)) {
    // 点文件/点目录**任何一层**都不是工程内容（与 `ProjectFileSource.paths()` 的
    // 既有口径同源；此处再挡一次是因为本函数也吃外部喂入的路径集）。
    if (path === "" || path.endsWith(DIR_SUFFIX) || isDotPath(path)) continue;
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
    const kind = kindOfPath(path);
    const leaf: MutableNode = {
      name: nameOf(path),
      path,
      kind,
      children: [],
      collapsible: false,
      readOnly: isReadOnlyPath(path),
    };
    if (dir === "") roots.push(leaf);
    else ensureDir(dir).children.push(leaf);
  }
  return sortNodes(roots as readonly ResourceNode[]);
}

/** 扁平化（搜索结果 / 「最近打开」共用一份遍历口径） */
export function flattenResources(nodes: readonly ResourceNode[]): ResourceNode[] {
  const out: ResourceNode[] = [];
  const walk = (list: readonly ResourceNode[]): void => {
    for (const node of list) {
      if (node.children.length > 0) walk(node.children);
      else out.push(node);
    }
  };
  walk(nodes);
  return out;
}

function sortNodes(nodes: readonly ResourceNode[]): ResourceNode[] {
  return [...nodes]
    .map((node) =>
      node.children.length > 0
        ? { ...node, children: sortNodes(node.children) }
        : node,
    )
    .sort((a, b) => {
      const aDir = a.children.length > 0;
      const bDir = b.children.length > 0;
      if (aDir !== bDir) return aDir ? -1 : 1; // 目录在前
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 父目录路径（带尾斜杠，根为 `""`）：`Lang/en/` → `Lang/`；`Stories/` → `""` */function parentOf(dirPath: string): string {
  const trimmed = dirPath.endsWith(DIR_SUFFIX) ? dirPath.slice(0, -1) : dirPath;
  const at = trimmed.lastIndexOf("/");
  return at < 0 ? "" : `${trimmed.slice(0, at + 1)}`;
}

/** 目录节点的显示名（去掉尾斜杠与父路径） */
function nameOf(path: string): string {
  const trimmed = path.endsWith(DIR_SUFFIX) ? path.slice(0, -1) : path;
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/** 点名判定：任一层以 `.` 开头即非工程内容（与适配器 `isDotName` 同口径） */
function isDotPath(path: string): boolean {
  return path
    .split("/")
    .some((segment) => segment.startsWith(".") && segment !== "");
}

// —— 目录收展持久化（会话内 ref → 本机视图偏好）——

/**
 * 目录收展持久化：**折叠集**按工程存本机（默认全展开，记住作者收起过哪些目录）。
 * 键按工程隔离——组件视图态跨工程残留防在根上（对齐列分组 `colgroups:` /
 * 节点图 `nodepos:` 先例）。任何存储失败都不抛：读失败/形状不对 = 空集（默认全展开），
 * 写失败 = 仅本次会话有效。编辑器永不因视图偏好而不可用。
 */
export const RESOURCE_TREE_COLLAPSED_KEY_PREFIX = "lingfan-editor-restree:";

/** 单工程折叠集条目上限（真实目录数远小于此；超限截断而非报错——视图偏好不值得拦人） */
export const COLLAPSED_DIRS_LIMIT = 512;

/** 折叠集读写（注入式存储；`undefined`/空工程 id = 无持久化，读写皆空操作） */
export function createCollapsedDirsStore(storage: KeyValueStorage | undefined): {
  load(projectId: string): ReadonlySet<string>;
  save(projectId: string, dirs: ReadonlySet<string>): void;
} {
  return {
    load(projectId: string): ReadonlySet<string> {
      if (projectId === "") return new Set();
      let raw: string | null;
      try {
        raw = storage?.getItem(RESOURCE_TREE_COLLAPSED_KEY_PREFIX + projectId) ?? null;
      } catch {
        return new Set();
      }
      if (raw === null) return new Set();
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return new Set();
      }
      // 信任边界：localStorage 可被篡改——非字符串/空串条目剔除（逐条降级，与偏好层同精神）
      if (!Array.isArray(parsed)) return new Set();
      const dirs = parsed.filter(
        (entry): entry is string => typeof entry === "string" && entry !== "",
      );
      return new Set(dirs.slice(0, COLLAPSED_DIRS_LIMIT));
    },
    save(projectId: string, dirs: ReadonlySet<string>): void {
      if (projectId === "") return;
      try {
        storage?.setItem(
          RESOURCE_TREE_COLLAPSED_KEY_PREFIX + projectId,
          JSON.stringify([...dirs].slice(0, COLLAPSED_DIRS_LIMIT)),
        );
      } catch {
        /* 存储不可用（配额 / 隐私模式）= 收展态仅本次会话有效 */
      }
    },
  };
}
