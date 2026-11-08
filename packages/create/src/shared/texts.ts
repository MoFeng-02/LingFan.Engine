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
    "  npm create @lingfan-engine [工程名]",
    "  pnpm create @lingfan-engine [工程名]",
    "  bun create @lingfan-engine [工程名]",
    "",
    "工程名之后按提示回答：工程名 → 描述 → 形态（可多选）。",
    "yarn 需要 2 及以上版本（classic 没有 create 子命令）；仍用 classic 时等价写法：",
    "  yarn dlx create-@lingfan-engine [工程名]",
    "",
    "包管理器不限：生成后的安装命令与后续步骤按调用方自己的包管理器给出。",
    "选项：",
    "  --description <文本>  工程描述（写进 package.json 与 Resources/project.json；可留空）",
    "  -d, --dir <路径>      生成到哪个目录下（缺省 = 当前目录）",
    "      --install         生成后立即安装依赖",
    "      --overwrite       目标目录非空时清空后继续",
    "  -y, --yes             全部取缺省值，不进入交互问答",
    "  -h, --help            显示本说明",
    "",
    "脚本用法：CI 里可以用参数直接指定形态，跳过问答。",
    "  -f, --framework <id>  框架（none / vue / react）",
    "  -s, --shell <id>      壳（browser / tauri / miniprogram）",
    "  -t, --sources <id>    故事源形态（ts / story）",
    "  --template <id>       等价写法：框架[-壳[-故事源]]，如 vue-tauri",
    "",
    "示例：",
    "  npm create @lingfan-engine my-story",
    "  npm create @lingfan-engine my-story --description 试菜单的小工程",
    "  npm create @lingfan-engine my-story --yes --install",
  ].join("\n"),
  /** 交互问答的提示语 */
  promptProjectName: "工程名",
  promptDescription: "描述",
  descriptionHint: "可留空；会写进 package.json 与 Resources/project.json",
  promptLayers: "形态",
  /** 非交互终端的处置 */
  nonInteractive: "当前不是交互终端，还有未指定的项",
  nonInteractiveHint:
    "请补 --yes 取全部缺省，或用参数指定：--description --framework --shell --sources",
  promptExisting: "目标目录已存在且有内容，怎么处理",
  /** 参数校验失败 */
  nameRequired: "工程名不能为空",
  nameInvalid:
    "工程名只能包含小写字母、数字、连字符与下划线，且不能以点或连字符开头",
  frameworkUnknown: "未知框架",
  shellUnknown: "未知壳",
  sourcesUnknown: "未知故事源形态",
  templateMalformed: "形态写法不对，应为 框架[-壳[-故事源]]",
  /** 形态多选 */
  layersEmptyHint: "回车 = 只用骨架（框架无关 + 浏览器）",
  layersInvalid: "没听懂这组编号，请用空格或逗号分隔的序号",
  layersConflict: "选中的层互相排斥",
  layersConflictHint: "重新选择（回车 = 全部缺省）",
  /** 目标目录已存在时的三种处置 */
  existingIgnore: "保留现有文件，同名覆盖",
  existingIgnoreHint: "只写本模板的文件，别的东西原地不动",
  existingClear: "清空目录后生成",
  existingClearHint: "删掉目录里的全部内容，不可撤销",
  existingCancel: "取消",
  existingCancelHint: "什么都不做，退出",
  targetExists: "目标目录已存在且非空，未做任何改动",
  templateMissing: "找不到模板目录：本包未随附模板内容，或开发态仓库结构不完整",
  /** 生成过程 */
  stageResolve: "解析模板与版本…",
  stageCopy: "写入工程文件…",
  stageInstall: "安装依赖…",
  doneTitle: "工程已生成",
  /** 生成后的三步提示；`<install>` / `<dev>` 由调用方按包管理器替换 */
  nextSteps: ["cd <name>", "<install>", "<dev>"].join("\n"),
  /** 非致命提示 */
  warnVersionOffline:
    "无法查询 npm registry 上的最新版本，已沿用模板记录的版本",
  warnInstallFailed: "依赖安装失败，请在工程目录内手动安装依赖",
} as const;

export type CreateTexts = typeof defaultCreateTexts;
