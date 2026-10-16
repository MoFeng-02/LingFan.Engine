/**
 * 舞台视图族：中央舞台内部的工作面与它的叶子件。
 *
 * 「时间线 / 舞台 / 节点图 / 步骤」是同一份故事的四种切面，
 * `FieldRow` 与 `ComponentPalette` 是它们共用的字段行与组件面板；
 * 分派（哪个切面显示）由 `../panes/CenterStage.vue` 负责，不在这里。
 */
export { default as StageEditor } from "./StageEditor.vue";
export { default as PreviewHost } from "./PreviewHost.vue";
export { default as NodeGraph } from "./NodeGraph.vue";
export { default as StepLayout } from "./StepLayout.vue";
export { default as StoryTimeline } from "./StoryTimeline.vue";
export { default as FieldRow } from "./FieldRow.vue";
export { default as ComponentPalette } from "./ComponentPalette.vue";
