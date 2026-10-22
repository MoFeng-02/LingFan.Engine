/**
 * 模板目录定位与元数据读取。
 *
 * 为什么需要「两处找」：模板内容在仓库里是 `template/v1`（与版本号一起在 git 里演进），
 * 但发布到 npm 的包里不可能把仓库根目录带上——`prepack` 时会把它复制进
 * `packages/create/template`。所以运行期先在包内找，找不到再退回仓库布局，
 * 让「仓内直接跑」与「装到别的工程里跑」走同一份代码。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 本包根目录（`packages/create`）：`src/registry/` 上溯两级 */
const PACKAGE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** 模板元数据：模板版本、占位符、可选的框架与壳 */
export interface TemplateMeta {
  /** 模板自身版本，独立于引擎版本 */
  readonly version: string;
  /** 此模板要求的最低引擎版本 */
  readonly minEngineVersion: string;
  /** 生成时整体替换的占位符 */
  readonly placeholder: string;
  /** 可选框架，首项为缺省值 */
  readonly frameworks: readonly TemplateOption[];
  /** 可选壳，首项为缺省值 */
  readonly shells: readonly TemplateOption[];
}

/** 一个可选项（框架或壳）：`id` 对应叠加层目录名 */
export interface TemplateOption {
  /** 叠加层目录名，也是命令行取值 */
  readonly id: string;
  /** 人读名称，交互问答里显示 */
  readonly label: string;
  /** 一句话说明，交互问答里作为提示 */
  readonly hint: string;
}

/**
 * 解析模板根目录。
 *
 * 顺序：包内 `template/`（发布形态）→ 仓库 `template/v1`（开发形态）。
 * 两者都不存在时返回 undefined，由调用方转成可读错误——这里不抛异常，
 * 因为「模板缺席」是部署问题而非参数问题，报错措辞在 CLI 层统一。
 */
export function resolveTemplateRoot(): string | undefined {
  const bundled = join(PACKAGE_ROOT, "template");
  if (existsSync(join(bundled, "template-meta.json"))) return bundled;
  const inRepo = resolve(PACKAGE_ROOT, "..", "..", "template", "v1");
  if (existsSync(join(inRepo, "template-meta.json"))) return inRepo;
  return undefined;
}

/**
 * 读取模板元数据。
 *
 * `frameworks` / `shells` 缺失时补成只剩缺省项的单元素表，而不是报错——旧模板
 * （只有骨架、没有框架分层）仍然可以被生成器消费，向后兼容由此保证。
 */
export function readTemplateMeta(root: string): TemplateMeta {
  const raw = JSON.parse(
    readFileSync(join(root, "template-meta.json"), "utf8"),
  ) as Partial<TemplateMeta> & { version: string; placeholder: string };
  return {
    version: raw.version,
    minEngineVersion: raw.minEngineVersion ?? "0.0.0",
    placeholder: raw.placeholder,
    frameworks: raw.frameworks ?? [SKELETON_ONLY],
    shells: raw.shells ?? [BROWSER_ONLY],
  };
}

/** 旧模板无框架分层时的缺省项：叠加层目录不存在 = 只用骨架 */
const SKELETON_ONLY: TemplateOption = {
  id: "none",
  label: "骨架（框架无关）",
  hint: "不叠加任何框架层",
};

/** 旧模板无壳分层时的缺省项 */
const BROWSER_ONLY: TemplateOption = {
  id: "browser",
  label: "浏览器",
  hint: "只生成 Web 端工程",
};

/** 叠加层目录名 */
export const OVERLAY_DIR = "overlays";

/**
 * 取某个选项对应的叠加层目录；不存在时返回 undefined。
 *
 * 「不存在」不一定是错误：缺省项（`none`/`browser`）本就没有叠加层，
 * 判定交给调用方——它知道自己在要的是「必须存在的层」还是「可以缺席的缺省层」。
 */
export function overlayDirOf(
  templateRoot: string,
  optionId: string,
): string | undefined {
  const dir = join(templateRoot, OVERLAY_DIR, optionId);
  return existsSync(dir) ? dir : undefined;
}
