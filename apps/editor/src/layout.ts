/**
 * 布局偏好的**持久化**：面板宽度 / 折叠态 / 侧栏模式。
 *
 * 纪律与既有先例同源（`columnGrouping` 的「本包零 I/O，存储由宿主注入」）：
 * ① 本模块**零 I/O**——`KeyValueStorage` 由组合根注入（浏览器 = localStorage，
 *    未来本地应用 = 配置文件）；② 任何存储失败**静默降级**（读失败 = 默认布局，
 *    写失败 = 仅本次会话有效）⇒ 编辑器永不因视图偏好而不可用；
 * ③ 布局属**应用**而非工程 ⇒ 键**不带** `story.id`（换工程保留布局，符合规划稿 §2.2⑦）。
 *
 * 版本化：结构演进靠 `version` 判定，不符一律降级为默认布局（fail-soft，不抛）。
 */

import type { KeyValueStorage } from "@lingfan/editor";

/** 侧栏模式（活动栏三个切面；共享同一份工程树，不重复持有数据） */
export type SidebarMode = "resources" | "search" | "recent";

/** 持久化形态 */
export interface LayoutState {
  version: 1;
  /** 左栏宽度（px） */
  leftWidth: number;
  /** 右栏宽度（px） */
  rightWidth: number;
  /** 左栏折叠（折叠后只剩活动栏） */
  leftCollapsed: boolean;
  /** 右栏折叠 */
  rightCollapsed: boolean;
  /** 侧栏当前模式 */
  sidebar: SidebarMode;
  /** 状态栏可见 */
  statusBar: boolean;
}

/** 宽度边界（与规划稿「默认窄 · 可拉宽」一致；越界即夹取，不拒绝渲染） */
export const MIN_SIDEBAR_WIDTH = 160;
export const MAX_SIDEBAR_WIDTH = 560;
export const MIN_RIGHT_WIDTH = 200;
export const MAX_RIGHT_WIDTH = 640;

export const LAYOUT_STORAGE_KEY = "lingfan-editor-layout:v1";

export function defaultLayout(): LayoutState {
  return {
    version: 1,
    leftWidth: 260,
    rightWidth: 320,
    leftCollapsed: false,
    rightCollapsed: false,
    sidebar: "resources",
    statusBar: true,
  };
}

/** 夹取到合法区间（非有限值回落默认——存储被外部改坏时不炸） */
export function clampLayout(state: LayoutState): LayoutState {
  const d = defaultLayout();
  const num = (value: unknown, min: number, max: number, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(min, Math.round(value)))
      : fallback;
  const mode = (value: unknown): SidebarMode =>
    value === "search" || value === "recent" || value === "resources" ? value : d.sidebar;
  return {
    version: 1,
    leftWidth: num(state.leftWidth, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, d.leftWidth),
    rightWidth: num(state.rightWidth, MIN_RIGHT_WIDTH, MAX_RIGHT_WIDTH, d.rightWidth),
    leftCollapsed: typeof state.leftCollapsed === "boolean" ? state.leftCollapsed : d.leftCollapsed,
    rightCollapsed: typeof state.rightCollapsed === "boolean" ? state.rightCollapsed : d.rightCollapsed,
    sidebar: mode(state.sidebar),
    statusBar: typeof state.statusBar === "boolean" ? state.statusBar : d.statusBar,
  };
}

/** 解析：顶层不符 / 版本不符 ⇒ 降级为默认布局（fail-soft，不抛） */
export function parseLayout(raw: string | null): LayoutState {
  if (raw === null || raw === "") return defaultLayout();
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return defaultLayout();
    }
    const candidate = value as Partial<LayoutState>;
    if (candidate.version !== 1) return defaultLayout();
    return clampLayout({ ...defaultLayout(), ...candidate });
  } catch {
    return defaultLayout();
  }
}

export function serializeLayout(state: LayoutState): string {
  return JSON.stringify({ ...state, version: 1 });
}

/** 存储读写：读失败 = 默认布局；写失败 = 静默（仅本次会话有效） */
export function createLayoutStore(storage: KeyValueStorage | undefined): {
  load(): LayoutState;
  save(state: LayoutState): void;
} {
  return {
    load(): LayoutState {
      try {
        return parseLayout(storage?.getItem(LAYOUT_STORAGE_KEY) ?? null);
      } catch {
        return defaultLayout();
      }
    },
    save(state: LayoutState): void {
      try {
        storage?.setItem(LAYOUT_STORAGE_KEY, serializeLayout(clampLayout(state)));
      } catch {
        // 隐私模式 / 配额满：布局偏好失效但功能不受影响
      }
    },
  };
}
