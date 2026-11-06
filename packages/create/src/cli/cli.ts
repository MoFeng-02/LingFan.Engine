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
  isOccupied,
  projectDirOf,
  type ExistingTarget,
} from "../generate/index.ts";
import {
  checkEngineCompatibility,
  readTemplateMeta,
  resolveTemplateRoot,
  resolveVersions,
  type TemplateMeta,
} from "../registry/index.ts";
import {
  askExisting,
  askOption,
  askProjectName,
  createTerminalIo,
  type PromptTexts,
} from "./prompts.ts";

/** 解析后的命令行参数；缺席项为 undefined，交由问答或模板缺省值补 */
export interface CreateArgs {
  readonly projectName?: string;
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

  const io = args.yes ? undefined : createTerminalIo();
  const promptTexts = texts;
  try {
    const projectName = await resolveName(args, promptTexts, io);
    if (projectName === undefined) return 1;
    const preset = resolvePreset(args.template, meta);
    if (preset === undefined) return 1;
    const framework = await resolveOption(
      "framework",
      args.framework ?? preset.framework,
      meta,
      promptTexts,
      io,
    );
    if (framework === undefined) return 1;
    const shell = await resolveOption(
      "shell",
      args.shell ?? preset.shell,
      meta,
      promptTexts,
      io,
    );
    if (shell === undefined) return 1;
    // 故事源不再提问：骨架自带整条 TS 创作链，它就是缺省形态。要手写 `.story`
    // 的人在命令行给 `--sources story` 或用 `--template` 带上第三段即可。
    const sources = args.sources ?? preset.sources ?? "ts";
    if (!meta.sources.some((option) => option.id === sources)) {
      process.stderr.write(`${texts.sourcesUnknown}：${sources}\n`);
      return 1;
    }
    const existing = await resolveExisting({
      args,
      projectName,
      io,
      texts: promptTexts,
    });
    if (existing === undefined) return 1;
    return await generate({
      args,
      meta,
      templateRoot,
      projectName,
      framework,
      shell,
      sources,
      existing,
    });
  } finally {
    io?.close();
  }
}

/**
 * 解析 `--template`：写作 `框架[-壳[-故事源]]`。
 *
 * 只做切分，合法性交给调用方——它已经要按模板声明校验一遍，这里再判一次
 * 会得到两套口径，日后加形态容易漏改其一。
 */
function resolvePreset(
  template: string | undefined,
  meta: TemplateMeta,
): { framework?: string; shell?: string; sources?: string } | undefined {
  if (template === undefined) return {};
  const parts = template.split("-").filter((part) => part !== "");
  if (parts.length === 0 || parts.length > 3) {
    process.stderr.write(
      `${defaultCreateTexts.templateMalformed}：${template}\n`,
    );
    return undefined;
  }
  const [framework, shell, sources] = parts;
  const known = (options: readonly { id: string }[], id: string): boolean =>
    options.some((option) => option.id === id);
  if (!known(meta.frameworks, framework)) {
    process.stderr.write(
      `${defaultCreateTexts.frameworkUnknown}：${framework}\n`,
    );
    return undefined;
  }
  if (shell !== undefined && !known(meta.shells, shell)) {
    process.stderr.write(`${defaultCreateTexts.shellUnknown}：${shell}\n`);
    return undefined;
  }
  if (sources !== undefined && !known(meta.sources, sources)) {
    process.stderr.write(`${defaultCreateTexts.sourcesUnknown}：${sources}\n`);
    return undefined;
  }
  return { framework, shell, sources };
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

/** 生成一步：查版本 → 写文件 → 可选安装 → 打印后续步骤 */
async function generate(input: {
  readonly args: CreateArgs;
  readonly meta: TemplateMeta;
  readonly templateRoot: string;
  readonly projectName: string;
  readonly framework: string;
  readonly shell: string;
  readonly sources: string;
  readonly existing: ExistingTarget;
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
  // 版本判定在写盘之前：模板要求的引擎还没发布时，生成出来的工程装不上，
  // 让它失败在「什么都没写」的时刻，而不是在别人的工程里第一次 pnpm dev 时。
  const incompatible = checkEngineCompatibility(
    input.meta.minEngineVersion,
    resolved,
  );
  if (incompatible !== undefined) {
    process.stderr.write(`${incompatible}\n`);
    return 1;
  }

  process.stderr.write(`${texts.stageCopy}\n`);
  let result;
  try {
    result = generateProject({ ...layout, existing: input.existing, resolved });
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
 * 解析框架/壳：值必须在模板声明的表里。
 *
 * 表是唯一事实来源——元数据没声明的形态，叠加层目录未必存在，放过去会生成出
 * 静默缺文件的工程。故事源不在这里判：它只剩「作者手写 `.story`」这一种偏离，
 * 由调用方按同一张表查一次即可。
 */
async function resolveOption(
  kind: "framework" | "shell",
  value: string | undefined,
  meta: TemplateMeta,
  texts: PromptTexts,
  io: Parameters<typeof askOption>[0] | undefined,
): Promise<string | undefined> {
  const options = kind === "framework" ? meta.frameworks : meta.shells;
  const invalidText =
    kind === "framework" ? texts.frameworkUnknown : texts.shellUnknown;
  const label =
    kind === "framework" ? texts.promptFramework : texts.promptShell;
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
