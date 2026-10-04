/**
 * 资源 → 视图的**分派表**（资源管理器的路由表）。
 *
 * 形状刻意对齐本仓已统一的四注册表（`register(key, value)` + `has(key)`，
 * dialogue·element·command·minigame）⇒ **不发明新范式**，一个通用枚举面覆盖全部。
 *
 * 三条纪律：
 * ① **未命中 ⇒ 只读预览**，不是报错、更不是空白（新增资源类型不改布局就能接入）；
 * ② **可编辑性由分派表声明**，不由路径猜（`readOnly` 是分派结论，不是二次判定）；
 * ③ 视图 id 是**纯数据**（本模块不 import 任何组件）⇒ 可测、宿主可替换。
 */

/** 视图 id（`"story"` 之外的资源视图在 B2 落地） */
export type ResourceViewId =
  | "story"
  | "lang"
  | "manifest"
  | "media"
  | "readonly";

export interface ResourceViewSpec {
  readonly view: ResourceViewId;
  /** 是否可在编辑器内改（只读视图不得给「保存」按钮） */
  readonly editable: boolean;
  /** 视图标题（标签页上显示，资源名之外的补充） */
  readonly title: string;
}

/**
 * 分派表：`kindOfPath` 的输出 → 视图。
 *
 * ⚠️ **与 `resourceTree.isReadOnlyPath` 的关系**：那是**模型层**的默认只读判据
 * （本批只有 `.story` 有编辑器）；本表是**宿主层**的最终结论。二者刻意分离——
 * 模型层不知道「将来会不会给译文表编辑器」，宿主层才是路由的**唯一事实源**。
 */
const DISPATCH: Readonly<Record<string, ResourceViewSpec>> = {
  story: { view: "story", editable: true, title: "故事" },
  lang: { view: "lang", editable: true, title: "译文表" },
  manifest: { view: "manifest", editable: true, title: "工程清单" },
  image: { view: "media", editable: false, title: "图片" },
  audio: { view: "media", editable: false, title: "音频" },
  video: { view: "media", editable: false, title: "视频" },
  saves: { view: "readonly", editable: false, title: "存档（运行时产物）" },
  other: { view: "readonly", editable: false, title: "未识别资源" },
};

/** 分派：资源种类 → 视图（未登记的种类归 `readonly`，**不抛错**） */
export function viewOfKind(kind: string): ResourceViewSpec {
  return DISPATCH[kind] ?? { view: "readonly", editable: false, title: "未识别资源" };
}

/** 该资源在编辑器内**是否可改**（宿主唯一口径，UI 据此决定保存按钮有无） */
export function isEditableKind(kind: string): boolean {
  return viewOfKind(kind).editable;
}

/** 已登记的视图种类（自检用：新增 `ResourceKind` 忘了登记会被抓到） */
export function registeredKinds(): string[] {
  return Object.keys(DISPATCH).sort();
}
