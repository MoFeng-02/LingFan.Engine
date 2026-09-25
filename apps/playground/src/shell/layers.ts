/**
 * ⑨-11 层级（z 序）解析（宿主侧纯函数，08 §一 RenderTargets 层序契约）：
 * **默认表 + 工程覆盖（project.json shell.layers）**——层级不写死：
 * 每个渲染层有语义化默认 z，作者可按项目整体覆盖（如「视频盖过对话」= video 调到 dialogue 之上）。
 *
 * 默认语义（间隔 100 便于项目插入自定义层）：
 * - video(100)：cutscene 视频——盖舞台背景/立绘，**不盖 say**（对话层在 video 等待期隐藏，见 App.vue）
 * - dialogue(999)：say/对话层（RenderTargets.dialogue）——内容层中最高
 * - choices(1100)：menu/input——对话层之上（等待期对话层已让位）
 * - minigame(1200)：整屏小游戏——盖对话
 * - notifications(1300)：toast
 * - toolbar(1400) / history(1500) / prefs(1500)：常驻 HUD 与面板
 *
 * 清单入参为 `unknown`（供给端口只保证「取到」，本地文件可被篡改/异版本——信任边界）：
 * 非数字/负值/未知键一律忽略，回退默认表（部分覆盖 = 逐键合并）。
 */

/** 舞台渲染层 id（与 08 §一 RenderTargets 及舞台 DOM 一一对应） */
export type LayerId =
  | "video"
  | "dialogue"
  | "choices"
  | "minigame"
  | "notifications"
  | "toolbar"
  | "history"
  | "prefs";

export type LayerZTable = Record<LayerId, number>;
export type LayerZOverrides = Partial<Record<LayerId, number>>;

export const LAYER_IDS: readonly LayerId[] = [
  "video",
  "dialogue",
  "choices",
  "minigame",
  "notifications",
  "toolbar",
  "history",
  "prefs",
];

/** 内建默认 z（语义化基线，见模块注释） */
export const DEFAULT_LAYER_Z: LayerZTable = {
  video: 100,
  dialogue: 999,
  choices: 1100,
  minigame: 1200,
  notifications: 1300,
  toolbar: 1400,
  history: 1500,
  prefs: 1500,
};

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * 解析层 z 表：内建默认 × 工程覆盖（shell.layers，逐键合并；非法键/值忽略）。
 * 纯函数可测；组合根装配一次，App 与视频适配器只消费结果。
 */
export function resolveLayerZ(
  manifest: unknown,
  defaults: LayerZTable = DEFAULT_LAYER_Z,
): LayerZTable {
  const resolved: LayerZTable = { ...defaults };
  if (manifest !== null && typeof manifest === "object") {
    const shell = (manifest as { shell?: unknown }).shell;
    if (shell !== null && typeof shell === "object") {
      const layers = (shell as { layers?: unknown }).layers;
      if (layers !== null && typeof layers === "object") {
        for (const id of LAYER_IDS) {
          const value = (layers as Record<string, unknown>)[id];
          if (isFiniteNonNegative(value)) resolved[id] = value;
        }
      }
    }
  }
  return resolved;
}

/**
 * 单控件实例 z 解析（三级链）：**实例显式指定 > 工程层默认 > 内建默认**。
 * 规则对所有控件一律适用（say/video/元素系统 alike）——story/控件参数里的
 * `z`（如 say 2 z-index=20）经此收敛；未指定即回层默认。元素系统落地时直接复用。
 */
export function resolveInstanceZ(
  layer: LayerId,
  instanceZ: number | undefined,
  table: LayerZTable = DEFAULT_LAYER_Z,
): number {
  return isFiniteNonNegative(instanceZ) ? instanceZ : table[layer];
}
