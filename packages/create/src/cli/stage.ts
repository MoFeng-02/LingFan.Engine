/**
 * 生成阶段：查版本 → 写文件 → 可选安装 → 打印后续步骤。
 *
 * 为什么与参数解析分开：这一段对使用者是「正在干活」的进度叙事，对测试是纯副作用，
 * 而参数解析是纯函数。两者放在一个文件里，任何一边的改动都要重新读另一边的代码。
 *
 * 入参自带形状而不复用命令行类型：本文件不需要知道参数是怎么解析出来的，只认得
 * 「要生成什么」。这也让方向保持单向——参数层依赖这里，这里不回头依赖参数层。
 */
import { resolve as resolvePath } from "node:path";
import { currentPackageManager, defaultCreateTexts } from "../shared/index.ts";
import {
  collectDependencyNames,
  generateProject,
  layerBases,
  type ExistingTarget,
} from "../generate/index.ts";
import {
  checkEngineCompatibility,
  resolveVersions,
  type TemplateMeta,
} from "../registry/index.ts";
import { installProject, renderNextSteps } from "./install.ts";

/** 生成阶段需要的信息；`description` 为空串表示产物里不出现该字段 */
export interface StageOptions {
  readonly meta: TemplateMeta;
  readonly templateRoot: string;
  /** 生成到哪个目录下；缺省为当前目录 */
  readonly dir: string | undefined;
  readonly projectName: string;
  readonly description: string;
  readonly framework: string;
  readonly shell: string;
  readonly sources: string;
  readonly existing: ExistingTarget;
  readonly install: boolean;
}

/**
 * 执行一次生成，返回进程退出码。
 *
 * 版本查询与兼容性判定都排在写盘之前：模板要求的引擎还没发布时，生成出来的工程
 * 装不上，让它失败在「什么都没写」的时刻，而不是在别人的工程里第一次启动时。
 */
export async function runStage(options: StageOptions): Promise<number> {
  const texts = defaultCreateTexts;
  const manager = currentPackageManager();
  const targetBase = resolvePath(options.dir ?? process.cwd());
  const layout = {
    templateRoot: options.templateRoot,
    targetBase,
    projectName: options.projectName,
    description: options.description,
    framework: options.framework,
    shell: options.shell,
    sources: options.sources,
    resolved: new Map<string, string>(),
  };

  process.stderr.write(`${texts.stageResolve}\n`);
  const names = collectDependencyNames(layerBases(layout));
  const resolved = await resolveVersions(names);
  if (resolved.size === 0 && names.length > 0) {
    process.stderr.write(`${texts.warnVersionOffline}\n`);
  }
  const incompatible = checkEngineCompatibility(
    options.meta.minEngineVersion,
    resolved,
  );
  if (incompatible !== undefined) {
    process.stderr.write(`${incompatible}\n`);
    return 1;
  }

  process.stderr.write(`${texts.stageCopy}\n`);
  let result;
  try {
    result = generateProject({
      ...layout,
      existing: options.existing,
      resolved,
    });
  } catch (error) {
    process.stderr.write(`${describe(error)}\n`);
    return 1;
  }

  let installed = false;
  if (options.install) {
    process.stderr.write(`${texts.stageInstall}\n`);
    installed = await installProject(result.projectDir, manager);
    if (!installed) process.stderr.write(`${texts.warnInstallFailed}\n`);
  }

  process.stdout.write(
    [
      "",
      `${texts.doneTitle}：${result.projectDir}`,
      `共 ${result.fileCount} 个文件，框架 ${result.framework}，壳 ${result.shell}，故事源 ${result.sources}`,
      "",
      installed ? "依赖已安装。" : "依赖未安装。",
      renderNextSteps(result.projectDir, manager, texts),
      "",
    ].join("\n"),
  );
  return 0;
}

/** 把异常折成一行提示：只暴露信息，不暴露堆栈 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
