/**
 * 参数校验与小工具。
 *
 * 为什么单独成文件：CLI 与生成编排都要判「工程名是否可用」，两处各写一份必然漂移
 * （一处放过 Windows 保留名，另一处不放），故只留这一处判定。
 */

/**
 * npm 包名与目录名共同接受的形态：小写字母/数字/连字符/下划线。
 *
 * 首字符限字母或数字：npm 明确禁止包名以 `.` 或 `_` 开头，而工程名同时要当包名用，
 * 放过下划线开头会让新工程在「日后想发布」时才发现不合规。
 */
const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** Windows 上不可用作目录名的保留字（大小写不敏感） */
const RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

/**
 * 工程名是否合法。
 *
 * 只接受小写形态：工程名同时进 `package.json` 的 `name`、`Resources/project.json`
 * 的 `id` 与目录名，三处共用一份字符串。大写会让 `name` 违反 npm 规范（npm 拒绝
 * 大写包名，日后想发布就卡住），故一开始就不放行，而不是事后改。
 */
export function isValidProjectName(name: string): boolean {
  if (name.length === 0 || name.length > 64) return false;
  if (!NAME_PATTERN.test(name)) return false;
  return !RESERVED_NAMES.has(name);
}

/**
 * 把任意人类输入收敛成合法工程名：小写、非法字符折叠成连字符、去首尾连字符。
 *
 * 用途是「给个建议值」——交互问答里预填，命令行参数仍然走严格校验，
 * 免得用户以为自己指定的名字被悄悄改过。
 */
export function suggestProjectName(input: string): string {
  const collapsed = input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return collapsed.length > 0 ? collapsed : "lingfan-story";
}

/** 描述的字符上限：`package.json#description` 在 npm 生态里的通行上限 */
export const DESCRIPTION_MAX_LENGTH = 200;

/**
 * 把自由文本收敛成可写入清单的描述。
 *
 * 全空白视为空，返回空串——调用方据此决定「不写这个字段」，而不是写一个空串进去。
 * 超长直接截断而不报错：描述不影响任何路径与命令，没有理由为一个输入框拦住生成。
 * 不校验字符集：它是给人看的自由文本，不是标识符。
 */
export function normalizeDescription(input: string): string {
  return input.trim().slice(0, DESCRIPTION_MAX_LENGTH).trim();
}

/**
 * 把用户输入的版本号归一成 `^x.y.z`。
 *
 * 为什么不直接写 `latest` 标签：标签每次安装都解析到当时的最高版本，同一份
 * `package.json` 在不同日子装出不同依赖，构建不可重现。生成时查一次、把具体
 * 版本号钉进清单，之后由使用者显式升级。
 *
 * 已经带范围符号（`^`、`~`、`>`、`<`、`=`、`*`）的输入原样返回——参数来自
 * registry 的 `latest` 字段时是裸版本号，但也会被直接传入，多包一层 `^~x` 会让
 * 清单解析失败。
 */
export function caretRange(version: string): string {
  return RANGE_PREFIXES.test(version) ? version : `^${version}`;
}

/** 版本范围符号；命中即视为调用方已指定范围 */
const RANGE_PREFIXES = /^[\^~><=*]/;
