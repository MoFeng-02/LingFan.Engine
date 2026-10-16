/** 叙事层出口（唯一出口）：接线（装配）与运行态（Vue 化状态）分列两个子目录。 */
export type {
  AppNarrative,
  AppNarrativeOptions,
  TypewriterHandle,
} from "./wiring/index.ts";
export { createAppNarrative } from "./wiring/index.ts";
export type { AppTemplates, AppTemplatesOptions } from "./wiring/index.ts";
export { createAppTemplates } from "./wiring/index.ts";
export { vueCells } from "./runtime/index.ts";
export type { VueNarrativeState } from "./runtime/index.ts";
export type {
  HostLayerZController,
  HostLayerZControllerOptions,
} from "./runtime/index.ts";
export { createHostLayerZController } from "./runtime/index.ts";
