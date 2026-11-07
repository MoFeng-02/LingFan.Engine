/**
 * CLI 域唯一出口。
 *
 * 只做转发：参数解析（`cli.ts`）、交互问答（`prompts.ts`）、依赖安装与后续命令
 * 渲染（`install.ts`）三层各自成文件，调用方从这里进出，不穿过文件名。
 */
export { parseArgs, runCreateCli } from "./cli.ts";
export type { CreateArgs } from "./cli.ts";
export {
  askExisting,
  askOption,
  askProjectName,
  createTerminalIo,
  pickOption,
} from "./prompts.ts";
export type { PromptIo, PromptTexts } from "./prompts.ts";
export {
  fillManagerCommands,
  installProject,
  renderNextSteps,
} from "./install.ts";
