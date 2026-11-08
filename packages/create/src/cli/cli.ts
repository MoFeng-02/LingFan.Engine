/**
 * 命令行入口。
 *
 * 分工：参数解析与流程编排在这里，「答案怎么合成」在 `answers.ts`，「问答怎么问」
 * 在 `prompts.ts`，「生成怎么做」在 `stage.ts`。本文件只负责把这四段串成一次运行，
 * 并把失败转成人能读的提示与退出码——库代码一律抛异常，只有这里决定措辞。
 *
 * 三个问题的顺序（工程名 → 描述 → 形态）由 `answers.ts` 保证，本文件不介入。
 */
import { resolve as resolvePath } from "node:path";
import { defaultCreateTexts } from "../shared/index.ts";
import {
  isOccupied,
  projectDirOf,
  type ExistingTarget,
} from "../generate/index.ts";
import { readTemplateMeta, resolveTemplateRoot } from "../registry/index.ts";
import { resolveAnswers } from "./answers.ts";
import { askExisting, createTerminalIo, type PromptTexts } from "./prompts.ts";
import { runStage } from "./stage.ts";

/** 解析后的命令行参数；缺席项为 undefined，交由问答或模板缺省值补 */
export interface CreateArgs {
  readonly projectName?: string;
  /** 工程描述；写进两份清单，空串或缺席表示不写该字段 */
  readonly description?: string;
  readonly template?: string;
  readonly framework?: string;
  readonly shell?: string;
  readonly sources?: string;
  readonly dir?: string;
  readonly install: boolean;
  readonly existing?: ExistingTarget;
  readonly yes: boolean;
  readonly help: boolean;
}

/** 参数解析失败：信息即用户可见提示 */
class ArgError extends Error {}

/**
 * 解析命令行。
 *
 * 支持 `--flag value` 与 `--flag=value` 两种写法：前者是手敲的习惯，
 * 后者在脚本里拼接更省事，两者都认不需要额外成本。
 *
 * 依赖缺省**不**安装：装依赖是几十秒到几分钟的副作用，脚本里更希望它显式请求
 * （`--install`）。旧脚本里的 `--no-install` 仍然认，等于什么都不做。
 */
export function parseArgs(argv: readonly string[]): CreateArgs {
  let projectName: string | undefined;
  let description: string | undefined;
  let template: string | undefined;
  let framework: string | undefined;
  let shell: string | undefined;
  let sources: string | undefined;
  let dir: string | undefined;
  let install = false;
  let existing: ExistingTarget | undefined;
  let yes = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inline] = splitFlag(arg);
    const takeValue = (): string => {
      if (inline !== undefined) return inline;
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("-")) {
        throw new ArgError(`选项 ${flag} 缺少取值`);
      }
      index += 1;
      return next;
    };
    switch (flag) {
      case "--description":
        description = takeValue();
        break;
      case "--template":
        template = takeValue();
        break;
      case "-f":
      case "--framework":
        framework = takeValue();
        break;
      case "-s":
      case "--shell":
        shell = takeValue();
        break;
      case "-t":
      case "--sources":
        sources = takeValue();
        break;
      case "-d":
      case "--dir":
        dir = takeValue();
        break;
      case "--install":
        install = true;
        break;
      case "--no-install":
        install = false;
        break;
      case "--overwrite":
        existing = "clear";
        break;
      case "-y":
      case "--yes":
        yes = true;
        break;
      case "-h":
      case "--help":
        help = true;
        break;
      default:
        if (flag.startsWith("-")) throw new ArgError(`未知选项：${flag}`);
        if (projectName !== undefined) {
          throw new ArgError(`多余的参数：${flag}`);
        }
        projectName = flag;
    }
  }
  return {
    projectName,
    description,
    template,
    framework,
    shell,
    sources,
    dir,
    install,
    existing,
    yes,
    help,
  };
}

/** 拆出 `--flag=value`；无等号时第二项为 undefined */
function splitFlag(arg: string): [string, string | undefined] {
  if (!arg.startsWith("--")) return [arg, undefined];
  const eq = arg.indexOf("=");
  if (eq < 0) return [arg, undefined];
  return [arg.slice(0, eq), arg.slice(eq + 1)];
}

/**
 * 执行一次生成，返回进程退出码。
 *
 * 不调用 `process.exit`：退出码作为返回值交出去，测试与 bin 垫片各自决定怎么用，
 * 也让「跑一遍」在测试里不会直接杀掉进程。
 */
export async function runCreateCli(argv: readonly string[]): Promise<number> {
  const texts = defaultCreateTexts;
  let args: CreateArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    if (error instanceof ArgError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
  if (args.help) {
    process.stdout.write(`${texts.banner}\n\n${texts.help}\n`);
    return 0;
  }

  const templateRoot = resolveTemplateRoot();
  if (templateRoot === undefined) {
    process.stderr.write(`${texts.templateMissing}\n`);
    return 1;
  }
  const meta = readTemplateMeta(templateRoot);

  // 只有「允许提问且确实能问」时才建问答面：`--yes` 承诺一个问题都不问；
  // 非交互终端（管道、CI、被重定向的 stdin）上没有回车可打，建出来只会挂在
  // 等一个永远不来的输入上。没有问答面时由 `answers.ts` 判定并给出可用参数。
  const interactive = !args.yes && process.stdin.isTTY === true;
  const io = interactive ? createTerminalIo() : undefined;
  try {
    const answers = await resolveAnswers({
      args,
      meta,
      templateRoot,
      io,
      texts,
    });
    if (answers === undefined) return 1;
    const existing = await resolveExisting({
      args,
      projectName: answers.projectName,
      io,
      texts,
    });
    if (existing === undefined) return 1;
    return await runStage({
      meta,
      templateRoot,
      dir: args.dir,
      projectName: answers.projectName,
      description: answers.description,
      framework: answers.framework,
      shell: answers.shell,
      sources: answers.sources,
      existing,
      install: args.install,
    });
  } finally {
    io?.close();
  }
}

/**
 * 决定目标目录非空时怎么处置。
 *
 * 缺省是取消：覆盖别人的工程无法撤销，`--yes` 也不该替人做这个决定。
 * `--overwrite` 是显式表态，交互模式下也会问一次。
 */
async function resolveExisting(input: {
  readonly args: CreateArgs;
  readonly projectName: string;
  readonly io: Parameters<typeof askExisting>[0] | undefined;
  readonly texts: PromptTexts & { readonly targetExists: string };
}): Promise<ExistingTarget | undefined> {
  const projectDir = projectDirOf({
    targetBase: resolvePath(input.args.dir ?? process.cwd()),
    projectName: input.projectName,
  });
  if (!isOccupied(projectDir)) return "cancel";
  if (input.args.existing !== undefined) return input.args.existing;
  if (input.io === undefined) {
    process.stderr.write(`${input.texts.targetExists}：${projectDir}\n`);
    return undefined;
  }
  const picked = await askExisting(input.io, input.texts);
  if (picked === "cancel") {
    process.stderr.write(`${input.texts.targetExists}：${projectDir}\n`);
    return undefined;
  }
  return picked;
}
