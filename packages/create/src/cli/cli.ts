/**
 * 命令行入口。
 *
 * 分工：参数解析与流程编排在这里，「问什么」在 `prompts.ts`，「生成什么」在
 * `generate` 域，「版本从哪来」在 `registry` 域。本文件只负责把这些串起来，
 * 并把失败转成人能读的提示与退出码——库代码一律抛异常，只有这里决定措辞。
 */
import { spawn } from "node:child_process";
import { resolve as resolvePath } from "node:path";
import { defaultCreateTexts } from "../shared/index.ts";
import { isValidProjectName, suggestProjectName } from "../shared/index.ts";
import {
  layerBases,
  generateProject,
  collectDependencyNames,
} from "../generate/index.ts";
import {
  readTemplateMeta,
  resolveTemplateRoot,
  resolveVersions,
  type TemplateMeta,
} from "../registry/index.ts";
import {
  askOption,
  askProjectName,
  createTerminalIo,
  type PromptTexts,
} from "./prompts.ts";

/** 解析后的命令行参数；缺席项为 undefined，交由问答或模板缺省值补 */
export interface CreateArgs {
  readonly projectName?: string;
  readonly framework?: string;
  readonly shell?: string;
  readonly sources?: string;
  readonly dir?: string;
  readonly install: boolean;
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
 */
export function parseArgs(argv: readonly string[]): CreateArgs {
  let projectName: string | undefined;
  let framework: string | undefined;
  let shell: string | undefined;
  let sources: string | undefined;
  let dir: string | undefined;
  let install = true;
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
      case "--no-install":
        install = false;
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
  return { projectName, framework, shell, sources, dir, install, yes, help };
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

  const io = args.yes ? undefined : createTerminalIo();
  const promptTexts = texts;
  try {
    const projectName = await resolveName(args, promptTexts, io);
    if (projectName === undefined) return 1;
    const framework = await resolveOption(
      "framework",
      args.framework,
      meta,
      promptTexts,
      io,
    );
    if (framework === undefined) return 1;
    const shell = await resolveOption(
      "shell",
      args.shell,
      meta,
      promptTexts,
      io,
    );
    if (shell === undefined) return 1;
    const sources = await resolveOption(
      "sources",
      args.sources,
      meta,
      promptTexts,
      io,
    );
    if (sources === undefined) return 1;
    return await generate({
      args,
      meta,
      templateRoot,
      projectName,
      framework,
      shell,
      sources,
    });
  } finally {
    io?.close();
  }
}

/** 生成一步：查版本 → 写文件 → 可选安装 → 打印后续步骤 */
async function generate(input: {
  readonly args: CreateArgs;
  readonly meta: TemplateMeta;
  readonly templateRoot: string;
  readonly projectName: string;
  readonly framework: string;
  readonly shell: string;
  readonly sources: string;
}): Promise<number> {
  const texts = defaultCreateTexts;
  const targetBase = resolvePath(input.args.dir ?? process.cwd());
  const layout = {
    templateRoot: input.templateRoot,
    targetBase,
    projectName: input.projectName,
    framework: input.framework,
    shell: input.shell,
    sources: input.sources,
    resolved: new Map<string, string>(),
  };

  process.stderr.write(`${texts.stageResolve}\n`);
  const names = collectDependencyNames(layerBases(layout));
  const resolved = await resolveVersions(names);
  if (resolved.size === 0 && names.length > 0) {
    process.stderr.write(`${texts.warnVersionOffline}\n`);
  }

  process.stderr.write(`${texts.stageCopy}\n`);
  let result;
  try {
    result = generateProject({ ...layout, resolved });
  } catch (error) {
    process.stderr.write(`${describe(error)}\n`);
    return 1;
  }

  let installed = false;
  if (input.args.install) {
    process.stderr.write(`${texts.stageInstall}\n`);
    installed = await install(result.projectDir);
    if (!installed) process.stderr.write(`${texts.warnInstallFailed}\n`);
  }

  process.stdout.write(
    [
      "",
      `${texts.doneTitle}：${result.projectDir}`,
      `共 ${result.fileCount} 个文件，框架 ${result.framework}，壳 ${result.shell}，故事源 ${result.sources}`,
      "",
      installed ? "依赖已安装。" : "依赖未安装。",
      texts.nextSteps.split("<name>").join(result.projectDir),
      "",
    ].join("\n"),
  );
  return 0;
}

/** 解析工程名：参数优先，参数非法即报错；交互模式打错会重问 */
async function resolveName(
  args: CreateArgs,
  texts: PromptTexts & { readonly nameInvalid: string },
  io: Parameters<typeof askProjectName>[0] | undefined,
): Promise<string | undefined> {
  if (args.projectName !== undefined) {
    if (isValidProjectName(args.projectName)) return args.projectName;
    process.stderr.write(`${texts.nameInvalid}：${args.projectName}\n`);
    return undefined;
  }
  if (io === undefined) {
    return suggestProjectName("");
  }
  return await askProjectName(io, texts, undefined);
}

/**
 * 解析框架/壳/故事源：必须真实存在对应的叠加层，否则报错。
 *
 * 只校验「模板声明过」而不校验「目录存在」会放过一种情况：元数据写了 `vue`
 * 但仓库里没有 `overlays/vue`，生成出来的工程静默缺少该框架的文件。
 */
async function resolveOption(
  kind: "framework" | "shell" | "sources",
  value: string | undefined,
  meta: TemplateMeta,
  texts: PromptTexts & { readonly overlayMissing: string },
  io: Parameters<typeof askOption>[0] | undefined,
): Promise<string | undefined> {
  const options =
    kind === "framework"
      ? meta.frameworks
      : kind === "shell"
        ? meta.shells
        : meta.sources;
  const invalidText =
    kind === "framework"
      ? texts.frameworkUnknown
      : kind === "shell"
        ? texts.shellUnknown
        : texts.sourcesUnknown;
  const label =
    kind === "framework"
      ? texts.promptFramework
      : kind === "shell"
        ? texts.promptShell
        : texts.promptSources;
  const picked =
    value !== undefined || io === undefined
      ? (value ?? options[0]?.id)
      : await askOption(io, label, options, undefined, invalidText);
  if (picked === undefined || !options.some((item) => item.id === picked)) {
    process.stderr.write(`${invalidText}：${String(picked)}\n`);
    return undefined;
  }
  return picked;
}

/**
 * 在工程目录里装依赖。
 *
 * 只有 pnpm：本仓与模板的工程都以 pnpm 为准（锁文件、workspace 协议改写都依赖它），
 * 换别的包管理器会生成第二份锁文件，日后发布还要再处理一遍。
 */
async function install(dir: string): Promise<boolean> {
  return await new Promise<boolean>((done) => {
    const child = spawn("pnpm", ["install"], {
      cwd: dir,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", () => done(false));
    child.on("close", (code) => done(code === 0));
  });
}

/** 把异常折成一行提示：只暴露信息，不暴露堆栈 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
