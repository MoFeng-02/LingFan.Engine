/**
 * 步骤布局域出口：把每列切分为「步骤」（等待态边界）并给出列间分支边。
 * 边界判据取自引擎的等待声明表，本域不做逐 op 判定。
 */
export {
  columnSteps,
  storySteps,
  type StepFork,
  type StoryStep,
  type StepLane,
  type StepEdge,
  type StepLayout,
  type StepOptions,
} from "./steps";
