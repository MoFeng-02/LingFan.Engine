/**
 * 挂载点骨架：按 `LayerZTable` 在父容器内建出覆盖层的各层，并交出挂载点表。
 *
 * 层的创建顺序即 DOM 叠放顺序（后建的默认盖在先建的之上），z 值显式写在层样式里，
 * 因此这里不依赖创建顺序来表达层级——顺序只影响同 z 时的回退比较。
 */
import { resolveInstanceZ } from "@lingfan/engine";
import type { LayerZTable } from "@lingfan/engine";
import { el } from "./dom";
import type { NarrativeMounts } from "./types";

/**
 * 在父容器内建出全部挂载点，返回挂载点表。
 *
 * 创建顺序有意保持与文档描述一致：root → stage（含 elementLayer）→ transition →
 * dialogue → choices → takeover → overlay。`takeover` 与 `choices` 初始不占位
 * （外部系统挂载、或进入选择等待时才显示）。
 */
export function createMounts(
  container: HTMLElement,
  layerZ: LayerZTable,
): NarrativeMounts {
  const root = el(container, "lf-overlay", 0);
  const stage = el(root, "lf-stage", resolveInstanceZ("stage", undefined, layerZ));
  const elementLayer = el(stage, "lf-element-layer", 0);
  const transition = el(
    root,
    "lf-transition",
    resolveInstanceZ("video", undefined, layerZ),
  );
  const dialogue = el(
    root,
    "lf-dialogue",
    resolveInstanceZ("dialogue", undefined, layerZ),
  );
  const choices = el(
    root,
    "lf-choices",
    resolveInstanceZ("choices", undefined, layerZ),
  );
  const takeover = el(
    root,
    "lf-takeover",
    resolveInstanceZ("minigame", undefined, layerZ),
  );
  const overlay = el(
    root,
    "lf-notifications",
    resolveInstanceZ("notifications", undefined, layerZ),
  );
  // 接管层空闲时不占位（外部系统挂载时才显示）
  takeover.style.display = "none";
  choices.style.display = "none";

  return {
    root,
    stage,
    elementLayer,
    dialogue,
    choices,
    overlay,
    takeover,
    transition,
  };
}
