/**
 * CLI 域唯一出口。
 *
 * 只做转发：参数解析（`cli.ts`）、答案合成（`answers.ts`）、交互问答（`prompts.ts`）、
 * 生成编排（`stage.ts`）、依赖安装与后续命令渲染（`install.ts`）各自成文件，
 * 调用方从这里进出，不穿过文件名。
 */
export { parseArgs, runCreateCli } from "./cli.ts";
export type { CreateArgs } from "./cli.ts";
export { resolveAnswers } from "./answers.ts";
export type { AnswerSources, AnswerTexts, CreateAnswers } from "./answers.ts";
export {
  askDescription,
  askExisting,
  askLayers,
  askProjectName,
  createTerminalIo,
  findLayerConflicts,
  parseLayerAnswer,
  pickOption,
} from "./prompts.ts";
export type { PromptIo, PromptTexts } from "./prompts.ts";
export { runStage } from "./stage.ts";
export type { StageOptions } from "./stage.ts";
export {
  fillManagerCommands,
  installProject,
  renderNextSteps,
} from "./install.ts";
