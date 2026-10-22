/**
 * 生成器集中文案。
 *
 * 为什么集中：CLI 呈现是唯一对使用者说话的地方，措辞散在多个文件里就会各自漂移
 * （一半说「工程」一半说「项目」）。集中一处后，改口径只需改这里。
 *
 * 用法：除 CLI 层外不要直接拼中文字符串；文案一律走这里，便于日后整体替换语言。
 */
export const defaultCreateTexts = {
  /** CLI 标题行，`<name>` 由调用方替换 */
  banner: "灵泛叙事引擎 · 工程生成器",
  help: [
    "用法：",
    "  npm create @lingfan-engine [工程名] [选项]",
    "  pnpm create @lingfan-engine [工程名] [选项]",
    "",
    "选项：",
    "  -f, --framework <id>  框架（缺省取模板声明的默认值）",
    "  -s, --shell <id>      壳（缺省取模板声明的默认值）",
    "  -d, --dir <路径>      生成到哪个目录下（缺省 = 当前目录）",
    "      --no-install      生成后不自动安装依赖",
    "  -y, --yes             全部取缺省值，不进入交互问答",
    "  -h, --help            显示本说明",
    "",
    "示例：",
    "  npm create @lingfan-engine my-story -- --framework vanilla --shell browser",
  ].join("\n"),
  /** 交互问答的提示语 */
  promptProjectName: "工程名",
  promptFramework: "框架",
  promptShell: "壳",
  promptInstall: "生成后立即安装依赖？",
  /** 参数校验失败 */
  nameRequired: "工程名不能为空",
  nameInvalid:
    "工程名只能包含小写字母、数字、连字符与下划线，且不能以点或连字符开头",
  dirMissing: "目标目录不存在",
  frameworkUnknown: "未知框架",
  shellUnknown: "未知壳",
  overlayMissing: "模板缺少该选项对应的叠加层",
  targetExists: "目标目录已存在且非空",
  templateMissing: "找不到模板目录：本包未随附模板内容，或开发态仓库结构不完整",
  /** 生成过程 */
  stageResolve: "解析模板与版本…",
  stageCopy: "写入工程文件…",
  stageInstall: "安装依赖…",
  doneTitle: "工程已生成",
  nextSteps: ["cd <name>", "pnpm install", "pnpm dev"].join("\n"),
  /** 非致命提示 */
  warnVersionOffline:
    "无法查询 npm registry 上的最新版本，已沿用模板记录的版本",
  warnInstallFailed: "依赖安装失败，请在工程目录内手动执行 pnpm install",
} as const;

export type CreateTexts = typeof defaultCreateTexts;
