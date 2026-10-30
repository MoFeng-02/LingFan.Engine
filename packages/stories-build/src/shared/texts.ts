/**
 * 集中文案表：stories-build 全部可注入的构建失败/诊断文案。
 *
 * 形态照 engine 的 `contracts/messages.ts`：具名方法接口 + 缺省实现对象；
 * 缺省实现即构建层的既有文案，不传 texts 行为不变。
 * 注入走编译入口 options（`StoryBuildOptions.texts` / `compileStories`
 * input.texts，均接受 Partial），入口处
 * `{ ...defaultStoriesBuildTexts, ...texts }` 合并后作为完整对象逐层透传——
 * 纯函数管道，无模块级可变状态、无注册表。
 *
 * 错误码前缀（E06/E10 等）是协议值，保留在文案内：自定义文案须自行保留
 * 前缀，否则按码检索的诊断路径（测试/工具）会失配。
 */
export interface StoriesBuildTexts {
  /** E06：列 id 为空或含不安全字符（story-compiler checkColumnIds） */
  columnIdUnsafe(id: string): string;
  /** E06：列 id 与先前列 id 重复（大小写不敏感；story-compiler checkColumnIds） */
  columnIdDuplicate(id: string, prev: string): string;
  /** E10：列体顶层 return（translate/statements） */
  topLevelReturn(): string;
  /** E10：break 出现在循环/switch 之外（translate/statements） */
  breakOutsideLoop(): string;
  /** E10：continue 出现在循环之外（translate/statements） */
  continueOutsideLoop(): string;
  /** unknown-op 闸门长文（pipeline/gates；detail = 已折叠的 op 明细行集） */
  unknownOpsGate(
    detail: string,
    resourcesDir: string,
    manifestFile: string,
  ): string;
  /** guard-unknown 闸门长文（pipeline/gates；firstGuard = 首个未声明守卫名） */
  unknownGuardsGate(
    detail: string,
    sourcesDir: string,
    firstGuard: string,
  ): string;
  /** 覆盖外 default 导出拒绝长文（discovery；files = 覆盖外文件相对路径列表） */
  uncoveredDefaults(files: readonly string[], sourcesDirName: string): string;
  /** 故事文件 node_modules 值导入的失败行（const-eval-pass；含 `dir/rel:line:col` 前缀） */
  storyNpmValueImport(
    rel: string,
    line: number,
    col: number,
    spec: string,
    sourcesDirName: string,
  ): string;
  /** 模块层 const 引用了 node_modules 值导入（graph/bindings） */
  constNpmReference(): string;
  /** node_modules 值导入被函数体/其他语句引用（graph/bindings） */
  npmNameConstOnly(name: string): string;
  /** config.ts 缺失（const-eval/config-eval） */
  configMissing(sourcesDirName: string, configFile: string): string;
  /** UI 说明符落在 `src/ui/` 之外（graph/scan/imports） */
  uiOutside(spec: string, sourceRootName: string): string;
  /** UI 导入的绑定名与目录名不一致（graph/scan/imports） */
  uiBindingName(name: string, received: string): string;
  /** UI 导入的文件名与目录名不一致（graph/scan/imports） */
  uiFileName(name: string, file: string): string;
  /** UI 导入必须是 default 导入（graph/scan/imports） */
  uiDefaultImport(name: string): string;
  /** 列级 uis 指向了不存在的 UI 目录（pipeline/gates；detail = 已折叠的明细行集） */
  unknownUisGate(detail: string, sourcesDir: string, uiDirName: string): string;
  /** UI 文件的 import 面越界（ui/scan-imports；detail = 已折叠的明细行集） */
  uiImportGate(detail: string, uiDirName: string): string;
}

/** 缺省文案：即 stories-build 的既有文案。 */
export const defaultStoriesBuildTexts: StoriesBuildTexts = {
  columnIdUnsafe: (id) => `列 id \`${id}\` 为空或含不安全字符（E06）`,
  columnIdDuplicate: (id, prev) =>
    `列 id \`${id}\` 与 ${prev} 重复（大小写不敏感，E06）`,
  topLevelReturn: () => "列体顶层不能 return（E10）：return 只能在函数体内",
  breakOutsideLoop: () => "break 在循环/switch 之外（E10）",
  continueOutsideLoop: () => "continue 在循环之外（E10）",
  unknownOpsGate: (detail, resourcesDir, manifestFile) =>
    `故事使用了既非内建、也未被清单 extensions 声明扩展提供的 op（运行期必 unknown-op，构建期拦截）：\n${detail}\n` +
    `→ 在 ${resourcesDir}/${manifestFile} 的 extensions 声明提供该 op 的扩展模块，或改用内建 op`,
  unknownGuardsGate: (detail, sourcesDir, firstGuard) =>
    `故事使用了未在源内 cell(...) 声明的守卫（运行期必 guard-unknown，构建期拦截）：\n${detail}\n` +
    `→ 在 ${sourcesDir} 源里用 cell("${firstGuard}", impl) 声明实现，或改用已声明的守卫`,
  uncoveredDefaults: (files, sourcesDirName) =>
    [
      "以下文件含 default 导出但未被 folders 覆盖——Stories.src 全量管理构建产物，未登记的故事会在构建时被当作陈旧产物删除：",
      ...files.map((rel) => `- ${sourcesDirName}/${rel}`),
      '请把所在目录加入 config.ts 的 folders（或使用 "*" 兜底）。',
    ].join("\n"),
  storyNpmValueImport: (rel, line, col, spec, sourcesDirName) =>
    `- ${sourcesDirName}/${rel}:${line}:${col} 故事文件不支持 node_modules 值导入 \`${spec}\`——npm 值请收敛为纯模块的导出 const（编译期求值仅作用于纯模块），再经相对导入使用（编译期求值引用域规则）`,
  constNpmReference: () =>
    "模块层 const 引用了 node_modules 值导入——仅导出的 const 可经编译期求值内联（请把 npm 值收敛为导出 const，见编译期求值规则）",
  npmNameConstOnly: (name) =>
    `node_modules 值导入 \`${name}\` 仅限模块层 const 初始化链（编译期求值引用域规则）：函数体与其他语句不得引用`,
  configMissing: (sourcesDirName, configFile) =>
    `${sourcesDirName}/${configFile} 不存在——多目录 TS 源工程需要布局声明` +
    `（export const folders/start/vars/state）：folders 声明源目录（可含 "*" 全量兜底），` +
    `start 声明入口故事文件名`,
  uiOutside: (spec, sourceRootName) =>
    `UI 说明符 \`${spec}\` 必须解析到 ${sourceRootName} 的兄弟目录 \`ui/<名>/<名>.<扩展名>\`` +
    `（UI 沙箱是源根的上一级，不是源根内部）`,
  uiBindingName: (name, received) =>
    `UI 导入的绑定名必须是目录名（import ${name} from ".../ui/${name}/${name}.vue"），收到 \`${received}\``,
  uiFileName: (name, file) =>
    `UI 文件名必须等于目录名：\`ui/${name}/\` 下只能有 \`${name}.<扩展名>\`，收到 \`${file}\``,
  uiDefaultImport: (name) =>
    `UI 导入必须是 default 导入（import ${name} from ".../ui/${name}/${name}.vue"）——一个 UI 只导出一个句柄`,
  unknownUisGate: (detail, sourcesDir, uiDirName) =>
    `列级 uis 声明了源里不存在的 UI（宿主按名字预加载时会落空，界面要到挂载瞬间才出现）：\n${detail}\n` +
    `→ 在 ${sourcesDir} 的兄弟目录 \`${uiDirName}/<名>/\` 下放实现文件 \`<名>.vue|.tsx|.html|.ts\`，或从列里去掉该名字`,
  uiImportGate: (detail, uiDirName) =>
    `UI 文件的 import 面越界（UI 不归构建管，越界依赖只能在这里拦）：\n${detail}\n` +
    `→ ${uiDirName}/** 下的文件只允许四类：相对路径引用 ${uiDirName}/ 内的文件、` +
    `框架包（vue / react / react-dom / react/jsx-runtime）、` +
    `从 @lingfan-engine/core 取纯类型（import type）、别名 @/${uiDirName}/**`,
};
