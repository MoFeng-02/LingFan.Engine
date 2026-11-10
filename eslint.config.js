import eslintConfigPrettier from "eslint-config-prettier";
import {
  defineConfigWithVueTs,
  vueTsConfigs,
} from "@vue/eslint-config-typescript";
import pluginVue from "eslint-plugin-vue";

/**
 * 边界规则（no-restricted-imports）**按文件域互斥拆分**：flat config 同名规则
 * 后块覆盖前块——若文件域重叠，只有最后一个块生效（会让部分禁令对引擎核心静默失效）。
 * 每个文件域只允许命中一个块。
 */
const NODE_GROUP = {
  group: ["node:*", "fs", "path", "os", "child_process"],
  message: "WebView 里没有 Node：文件/进程必经 Rust 命令",
};
const ASSET_GROUP = {
  group: [
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.gif",
    "*.webp",
    "*.svg",
    "*.ico",
    "*.mp3",
    "*.ogg",
    "*.wav",
    "*.m4a",
    "*.flac",
    "*.mp4",
    "*.webm",
  ],
  message:
    "资源禁止构建期 import：经 ResourcePort 逻辑寻址，由平台适配器供数（可能是加密资源）",
};

/**
 * 老 WebView 内建守卫的**单一来源**（基线 Safari 13.1+ / Chrome 85+）。
 *
 * 为什么是常量而不是各块各抄一份：flat config 按**规则名整体覆盖**，
 * `lingfan/pure-layer-no-dom` 与 `lingfan/pure-layer-entry-reexport` 的文件域都比
 * `lingfan/legacy-webview-compat` 窄，它们只要写了 `no-restricted-syntax`，前块这 16 条
 * 就会在这些文件上整体作废。所以这两块必须**把自己的这份补全**。
 *
 * 而「补全」若靠逐字复制，规则演进时必然漂移——漏改一处就是静默失效，
 * 正是要治的那类根。三处引用同一个常量，漂移在语法上就不可能发生。
 * 生效面另有 tests/tools/pure-layer-dom.test.ts 的正面断言兜底。
 */
const LEGACY_WEBVIEW_SELECTORS = [
  {
    selector: "MemberExpression[property.name='at']",
    message:
      "Array/String.prototype.at 是 ES2022（Chrome 92+/Safari 15.4+），目标 WebView 含 Chrome 91——用 arr[arr.length - 1] 替代",
  },
  {
    selector: "MemberExpression[property.name='findLast']",
    message:
      "Array.prototype.findLast 是 ES2023（Chrome 97+/Safari 15.4+），基线 Safari 13.1+/Chrome 85+ 不含——用手写倒序循环替代",
  },
  {
    selector: "MemberExpression[property.name='findLastIndex']",
    message:
      "Array.prototype.findLastIndex 是 ES2023（Chrome 97+/Safari 15.4+），基线 Safari 13.1+/Chrome 85+ 不含——用手写倒序循环替代",
  },
  {
    selector: "MemberExpression[property.name='toSorted']",
    message:
      "Array.prototype.toSorted 是 ES2023 change-array-by-copy（Chrome 110+/Safari 16.4+），基线不含——用 slice().sort() 替代",
  },
  {
    selector: "MemberExpression[property.name='toReversed']",
    message:
      "Array.prototype.toReversed 是 ES2023 change-array-by-copy（Chrome 110+/Safari 16.4+），基线不含——用 slice().reverse() 替代",
  },
  {
    selector: "MemberExpression[property.name='toSpliced']",
    message:
      "Array.prototype.toSpliced 是 ES2023 change-array-by-copy（Chrome 110+/Safari 16.4+），基线不含——用 slice() 后 splice 替代",
  },
  {
    selector: "MemberExpression[property.name='with']",
    message:
      "Array.prototype.with 是 ES2023 change-array-by-copy（Chrome 110+/Safari 16.4+），基线不含——用 slice() 后赋值替代",
  },
  {
    selector: "MemberExpression[property.name='isWellFormed']",
    message:
      "String.prototype.isWellFormed 是 ES2024（Chrome 111+/Safari 16.4+），基线不含——用显式孤立代理项检查替代",
  },
  {
    selector: "MemberExpression[property.name='toWellFormed']",
    message:
      "String.prototype.toWellFormed 是 ES2024（Chrome 111+/Safari 16.4+），基线不含——用显式孤立代理项替换替代",
  },
  {
    selector: "MemberExpression[object.name='Object'][property.name='hasOwn']",
    message:
      "Object.hasOwn 是 ES2022（Chrome 93+/Safari 15.4+），基线不含——用 Object.prototype.hasOwnProperty.call 替代",
  },
  {
    selector: "MemberExpression[object.name='Promise'][property.name='any']",
    message:
      "Promise.any 是 ES2021（Chrome 85+ 但 Safari 15+），目标 WebView 含 Safari 13-15——用 Promise 链或手写聚合替代",
  },
  {
    selector:
      "MemberExpression[object.name='Array'][property.name='fromAsync']",
    message:
      "Array.fromAsync 是 ES2024（Chrome 121+/Safari 16.4+），基线不含——用 for 循环 push 替代",
  },
  {
    selector: "MemberExpression[object.name='Object'][property.name='groupBy']",
    message:
      "Object.groupBy 是 ES2024（Chrome 117+/Safari 17.4+），基线不含——用 reduce 替代",
  },
  {
    selector: "MemberExpression[object.name='Map'][property.name='groupBy']",
    message:
      "Map.groupBy 是 ES2024（Chrome 117+/Safari 17.4+），基线不含——用 reduce + Map 替代",
  },
  {
    selector:
      "MemberExpression[object.name='AbortSignal'][property.name='timeout']",
    message:
      "AbortSignal.timeout 需 Chrome 103+/Safari 16+，基线不含——用 AbortController + setTimeout 替代",
  },
  {
    selector:
      "MemberExpression[object.name='crypto'][property.name='randomUUID']",
    message:
      "crypto.randomUUID 需 Chrome 92+/Safari 15.4+，基线不含——用 crypto.getRandomValues 手写 UUID 替代",
  },
];

/** 配套的 2 项全局禁用，同样单一来源（理由同上）。 */
const LEGACY_WEBVIEW_GLOBALS = [
  {
    name: "structuredClone",
    message:
      "structuredClone 需 Chrome 98+/Safari 15.4+，基线 Safari 13.1+/Chrome 85+ 不含——用 JSON 往返或手写深拷贝替代",
  },
  {
    name: "BigInt",
    message:
      "BigInt 全局需 Safari 14+，基线 Safari 13.1 不含（esbuild 同样拒绝 bigint 字面量）——避免 BigInt 值",
  },
];

export default defineConfigWithVueTs(
  {
    name: "lingfan/files-to-lint",
    files: ["**/*.{ts,mts,tsx,vue}"],
  },
  {
    name: "lingfan/files-to-ignore",
    ignores: [
      "**/dist/**",
      "**/dist-enc/**",
      "**/coverage/**",
      "**/src-tauri/**",
      "**/node_modules/**",
      // 测试夹具的临时工作区：测试跑完即删，但**测试与 lint 并发时**可能正在被删
      // ⇒ eslint 扫到半途消失的文件会报 ENOENT 直接崩（非代码问题）。
      // 三个测试文件各有自己的 BASE：build-pipeline(.tmp-build) / func-collision(.tmp-collide)
      // / typegen(.tmp-typegen)——按前缀一并忽略，新增夹具目录不必再改这里。
      "**/.tmp-*/**",
      // 本地工作区目录（脚本 / 临时探针）：不入版本库，其中 .cjs 探针
      // 按 CommonJS 写(require)，与仓库 TS 源的模块规范不同
      "**/私有文档/**",
      // 会话级探针目录（.vitest/）：临时验证脚本，git-ignored、非仓库源码，
      // 探针为一次性验证文件，常带即写即弃的风格——免检（同上：非仓库源码）
      "**/.vitest/**",
      // docs 站的 Astro 生成物（content.d.ts / types.d.ts）：astro build/sync 产物，
      // 风格由生成器负责，不入版本库——免检
      "**/.astro/**",
      // stories:build 的生成物（fun_register.g.ts / *.gen.d.ts）：实现文本从源原样
      // 搬运、类型面由收集结果拼装，缩进/风格由生成器负责——入库但免检
      // （.prettierignore 已同步）
      "**/src/gen/**",
      // 生成器验证工程的落地目录：内容是 `lingfan-create` 的产物，各层自带
      // tsconfig 与框架依赖（vue / @vitejs/plugin-vue 等），本仓没装那些包，
      // 纳入检查只会得到必然的解析失败。与 tsconfig 的 include 口径一致（同样不含它）。
      "CreateDemo/**",
    ],
  },
  pluginVue.configs["flat/essential"],
  vueTsConfigs.recommended,
  eslintConfigPrettier,
  {
    name: "lingfan/allow-single-word-app",
    // 单文件组件名不满足「多词」约定：应用外壳（App.vue）与**路由页**——
    // 页面文件名即路由路径（由 pages.json 决定），组件名跟路由走，不由命名约定决定。
    // 宿主的普通页面（`pages/start/start.vue`）同理：文件名即入口名，单名是规则要求。
    // `src/ui/**` 同理：UI 的绑定名由目录名决定（`ui/hub/hub.vue` 只能导成 `hub`），
    // 名字是构建期事实而非风格选择，单名在这里是规则要求。
    files: [
      "apps/playground/src/App.vue",
      "apps/playground/src/pages/**/*.vue",
      "apps/editor/src/App.vue",
      "apps/miniprogram/src/pages/**/*.vue",
      "apps/*/src/ui/**/*.vue",
      // 模板骨架里的 UI 示例同理：目录名即 UI 名（`ui/hint/hint.vue` 只能导成 `hint`），
      // 而模板会被复制成使用者的工程，命名约束在那里同样成立。
      "template/*/overlays/*/src/ui/**/*.vue",
      "packages/create/template/overlays/*/src/ui/**/*.vue",
    ],
    rules: {
      "vue/multi-word-component-names": "off",
    },
  },
  {
    name: "lingfan/max-lines-source",
    // 单文件行数的机器门禁（对应架构纪律里的「禁止上帝文件」）。
    //
    // 口径是**有效代码行**（不含注释与空行），故 `skipBlankLines` 与 `skipComments`
    // 两个开关缺一不可。少了 skipComments，满篇 JSDoc 的文件会被误判超标。
    //
    // 只设硬上限，不设软阈值：软阈值是「应当拆分」的架构判断，属于人的决策；
    // 硬上限才是必须拆的红线。把建议也做成机器拒绝，等于让机器替人做架构决策。
    //
    // 级别用 `warn` 而非 `error`：`lint` 脚本不带 `--max-warnings`，
    // 因此 warn 只作提示、不阻断流水线；用 error 会让存量偏大的文件立刻判红。
    //
    // 测试域排除：测试文件按功能域拆文件、不按行数硬卡，这是同一条纪律里写明的例外。
    // 全仓超出硬上限的文件目前全是测试，排除后源码侧零警告，
    // 否则噪音会淹掉真信号。
    files: ["**/*.{ts,mts,tsx,js,mjs,cjs}"],
    ignores: ["tests/**", "**/*.test.*", "**/*.spec.*"],
    rules: {
      "max-lines": [
        "warn",
        { max: 500, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    name: "lingfan/max-lines-vue",
    // `.vue` 单文件组件含模板与样式，上限放宽到 600。
    // 与上一块按扩展名互斥——flat config 同名规则后块覆盖前块，
    // 两块文件域不得重叠（与文件头「按文件域互斥拆分」的既有纪律一致）。
    files: ["**/*.vue"],
    ignores: ["tests/**"],
    rules: {
      "max-lines": [
        "warn",
        { max: 600, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    name: "lingfan/unused-conventions",
    // `_` 前缀 = 有意不用的形参/变量（如 fail-closed 运行期守卫的签名占位：
    // 参数只为调用点类型存在，运行期必抛）——生态标准约定，显式放行
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    name: "lingfan/core-boundaries",
    // 核心层框架无关——可用 Web 标准 API，禁止 UI 框架 / Tauri API / Node
    // packages/editor（编辑器核心，纯映射器）与 tests/engine|editor/**（集中测试目录）
    // 测试同样受核心层边界约束（测试集中化）
    files: [
      "packages/core/**/*.{ts,vue}",
      "packages/editor/**/*.ts",
      "tests/engine/**/*.ts",
      "tests/editor/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["vue", "vue-*", "pinia", "@vue/*", "@tauri-apps/*"],
              message: "核心层框架无关：禁止 import UI 框架与 Tauri API",
            },
            NODE_GROUP,
            ASSET_GROUP,
          ],
        },
      ],
    },
  },
  {
    name: "lingfan/runtime-import-boundaries",
    // WebView 没有 Node；资源禁止构建期 import——
    // 资源由平台适配器供数（静态根是未加密的开发形态；加密后由 Rust 解密返回 Blob URL），
    // 构建期 import / 静态直引在加密形态下无文件可指。适配器实现文件（@tauri-apps 等）集中在本域。
    files: [
      "packages/adapters/**/*.ts",
      "packages/ui/**/*.ts",
      "apps/*/src/**/*.{ts,vue}",
      "template/**/src/**/*.{ts,vue}",
      "tests/adapters/**/*.ts",
      "tests/ui/**/*.ts",
      "tests/playground/**/*.ts",
      "tests/template/**/*.ts",
      // 小程序宿主测试与 adapters/ui 同域：都在 WebView（或小程序运行层）里跑，不受 Node 面
      "tests/miniprogram/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [NODE_GROUP, ASSET_GROUP],
        },
      ],
    },
  },
  {
    name: "lingfan/legacy-webview-compat",
    // 老 WebView 内建方法守卫：基线 = Safari 13.1+ / Chrome 85+——
    // replaceAll（Chrome 85/Safari 13.1 起支持）在基线内合法，不在守卫之列；
    // 只拦基线之后的内建方法/全局（Chrome 92+ 一族 + Safari 15 才有的 Promise.any），
    // 命中即老 WebView TypeError → 模块执行中断 → #app 空 → 白屏。
    // 语法层兼容由 vite build.target=safari13 负责（esbuild 不补内建方法，守卫在这里）。
    files: ["packages/**/*.ts", "apps/*/src/**/*.{ts,vue}"],
    rules: {
      "no-restricted-syntax": ["error", ...LEGACY_WEBVIEW_SELECTORS],
      "no-restricted-globals": ["error", ...LEGACY_WEBVIEW_GLOBALS],
    },
  },
  {
    name: "lingfan/pure-layer-no-dom",
    // 纯层：渲染描述树（packages/ui）与宿主装配语义（packages/shell）都必须在
    // 任何平台之外成立——否则小程序与未来 AOT 拿不到可用实现。DOM 只允许出现在
    // packages/ui/src/dom/（DOM 物化器与覆盖层表面，目录头注释已声明该边界）。
    //
    // 注意：flat config 是**后块覆盖前块**：本块 files 比 lingfan/legacy-webview-compat
    // 窄，若本块只配 DOM 项，老 WebView 内建守卫（16 条 MemberExpression 选择器 +
    // structuredClone/BigInt）就会在 packages/ui 与 packages/shell 里**静默失效**
    // 。故这里把前块的同名规则条目完整复制，再追加 15 项 DOM 全局与
    // dom 目录的 import 拦截。重复是覆盖语义下的唯一正确做法。
    // 防漂移由 tests/tools/pure-layer-dom.test.ts 兜底：该测试既断言本块带齐
    // legacy 条目，也做一次真实 lintText 证明 structuredClone 仍被咬。
    //
    // `packages/core` 不在本块内：那里 `window` 是**叙事 op 名**
    // （`runtime/ops/dispatch.ts` 的 `case "window"`）。将来若扩面必须先排掉这些。
    files: ["packages/ui/src/**/*.ts", "packages/shell/src/**/*.ts"],
    ignores: ["packages/ui/src/dom/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        // —— 16 条老 WebView 守卫经单一来源 LEGACY_WEBVIEW_SELECTORS 展开 ——
        ...LEGACY_WEBVIEW_SELECTORS,
        // —— 纯层追加：dom 实现目录不得被相对 import ——
        // 类型位置（`x: HTMLElement`）不会被 no-restricted-globals 拦（那是
        // TSTypeReference），故类型面的兜底交给体检测试。
        {
          selector: "ImportDeclaration[source.value=/^\\.\\/dom/]",
          message:
            "纯层不得 import DOM 实现——RenderPort 由宿主注入（DOM 实现在 packages/ui/src/dom/）",
        },
        // 再导出与 import 等价：`export { x } from "./dom"` 会把 DOM 实现重新暴露给
        // 下游，纯层的「零 DOM」在入口处就被绕开了。命名导出与 `export *` 是两种
        // AST 形态，各配一条；缺一条就留一条无声的泄漏路径。
        {
          selector: "ExportNamedDeclaration[source.value=/^\\.\\/dom/]",
          message: "纯层不得再导出 DOM 实现——DOM 层只在宿主组合根装配",
        },
        {
          selector: "ExportAllDeclaration[source.value=/^\\.\\/dom/]",
          message: "纯层不得再导出 DOM 实现——DOM 层只在宿主组合根装配",
        },
      ],
      "no-restricted-globals": [
        "error",
        // —— 2 项老 WebView 全局经单一来源 LEGACY_WEBVIEW_GLOBALS 展开 ——
        ...LEGACY_WEBVIEW_GLOBALS,
        // —— 纯层追加：DOM 值引用一律禁止 ——
        {
          name: "window",
          message: "纯层不得引用 DOM 全局——平台动作以接口注入",
        },
        { name: "document", message: "同上" },
        { name: "navigator", message: "同上" },
        {
          name: "localStorage",
          message: "同上；持久化走 PreferencesPort / SavePort",
        },
        { name: "sessionStorage", message: "同上" },
        {
          name: "HTMLElement",
          message:
            "纯层不得引用 DOM 类型——需要节点时用 RenderSpec / RenderPort",
        },
        { name: "Element", message: "同上" },
        { name: "Node", message: "同上" },
        { name: "HTMLDivElement", message: "同上" },
        { name: "HTMLImageElement", message: "同上" },
        { name: "HTMLVideoElement", message: "同上" },
        {
          name: "requestAnimationFrame",
          message: "帧源以 FrameSource 接口注入",
        },
        { name: "cancelAnimationFrame", message: "同上" },
        {
          name: "ResizeObserver",
          message: "尺寸变化由宿主监听后调 fitter.refresh()",
        },
        { name: "matchMedia", message: "同上" },
      ],
    },
  },
  {
    name: "lingfan/pure-layer-entry-reexport",
    // `packages/ui/src/index.ts` 是包根入口：`package.json` 只有一条 `exports`（"."），
    // 宿主拿不到深路径，DOM 成品**只能**经这里取用（`packages/create` 的模板宿主即如此）。
    // 所以入口允许再导出 dom 目录的成品——这也正是「DOM 层在宿主组合根装配」的取用点。
    //
    // 放开的面**只有出口那两条**：本块不写 `ExportNamedDeclaration` / `ExportAllDeclaration`
    // 选择器，它们归 lingfan/pure-layer-no-dom 管、在本文件上被本块覆盖掉。
    // 但 `no-restricted-syntax` 是**按规则名整体覆盖**的：本块一旦出现这条规则，
    // 前面所有块对该规则名的配置就全部作废。所以下面必须把 lingfan/legacy-webview-compat
    // 的 16 条 MemberExpression 选择器**逐字复制**进来，再补 dom 目录的 import 拦截——
    // 否则入口文件上的老 WebView 内建守卫会静默失效（同一个覆盖陷阱，在入口层再犯一次）。
    // 「本文件是纯再导出表、没有表达式可命中」不是理由：ESLint 不知道谁是再导出表。
    //
    // `no-restricted-globals`（structuredClone/BigInt + 15 项 DOM 全局）本块不重述：
    // 不写即不被覆盖，仍由 lingfan/pure-layer-no-dom 生效。
    // 生效面的防漂移由 tests/tools/pure-layer-dom.test.ts 正面断言兜底。
    files: ["packages/ui/src/index.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        // —— 16 条老 WebView 守卫经单一来源 LEGACY_WEBVIEW_SELECTORS 展开 ——
        ...LEGACY_WEBVIEW_SELECTORS,
        // —— 入口沿用纯层的 dom import 拦截（与其 canonical 逐字相同）——
        // —— 纯层追加：dom 实现目录不得被相对 import ——
        // 类型位置（`x: HTMLElement`）不会被 no-restricted-globals 拦（那是
        // TSTypeReference），故类型面的兜底交给体检测试。
        {
          selector: "ImportDeclaration[source.value=/^\\.\\/dom/]",
          message:
            "纯层不得 import DOM 实现——RenderPort 由宿主注入（DOM 实现在 packages/ui/src/dom/）",
        },
      ],
    },
  },
  {
    name: "lingfan/node-side-tooling",
    // TS 故事源管线是 Node 侧创作期工具（tsx 运行）——其脚本与测试需要
    // node:fs 等（不在 WebView 运行，不受「WebView 无 Node」守卫；编辑器/引擎/Rust 零感知）
    files: [
      "apps/playground/scripts/**/*.{ts,mjs}",
      // 创作链编译包（@lingfan-engine/stories-build）：同上，Node 侧创作期工具，
      // 且它是 `apps/playground/scripts` 原管线的搬移归宿——例外随代码一起搬家
      "packages/stories-build/**/*.{ts,mjs}",
      // 创作链编译域的测试整域豁免（读文件、跑 CLI 的用例都在这儿）
      "tests/stories-build/**/*.ts",
      // 编辑器的**本地服务宿主**（仅回环 HTTP + 外部打开）——
      // Node 侧运行，浏览器端代码零感知（前端只做能力探测，不假设它在）
      "apps/editor/server/**/*.ts",
      "tests/editor/server-*.test.ts",
      // token 守卫需要**读编辑器源码**做机械核对（扫裸色值/裸字号）
      // —— 属测试期工具，不进浏览器产物
      "tests/editor/token-guard.test.ts",
      // 骨架接线守卫需要**读编辑器源码与全局样式**做机械核对（接线锚点/横幅样式）
      // —— 属测试期工具，不进浏览器产物；
      // 其读的 styles/app-workspace.css 的 `?raw` 导入在 vitest（css:false）下
      // 被 stub 成空串 ⇒ 只能 readFileSync
      "tests/editor/skeleton-wiring.test.ts",
      // 诊断面板类名隔离守卫：同理**读全部组件模板**做跨组件撞名核对
      // （撞名会让选择器/探针指向别的面板，症状是「功能坏了」的误判）
      "tests/editor/diagnostics-css-isolation.test.ts",
      // 纯图标按钮 a11y 守卫：同理**读全部组件模板**做 aria-label 核对
      // （title 不进无障碍树 ⇒ 纯图标按钮无aria-label = 对读屏用户不存在）
      "tests/editor/aria-label-guard.test.ts",
      // 真实工程形态验证：需**读仓外真实工程**核对多语言布局与场景类型分布 —— 属测试期工具
      "tests/engine/data/real-project-scene-type.test.ts",
      // 真实工程**端到端打开**守卫：同理读仓外真实工程，
      // 验「四个阻塞全解除」——组装成功 / 类型识别 / 编排保住 / 无拍平产物
      "tests/engine/data/real-project-open.test.ts",
      // Script 词汇层互锁守卫：读词汇层源文件做「登记 ↔ 导出」一致性核对（测试期工具）
      "tests/editor/script-vocabulary.test.ts",
      // 词汇层声明重建 CLI：读 words 源 + 注册表键，差量写生成物（Node 侧生成工具；
      // 渲染是纯函数 vocabulary-gen，本文件只做 IO 与主模块守卫）
      "packages/editor/src/script/generate-vocabulary.ts",
      // 禁选守卫需要**读模板样式表**做机械核对；模板样式已从 index.html 抽成独立
      // `.css`，而 `?raw` 导入 `.css` 在 vitest（css:false）下同样被 stub 成空串
      // ⇒ 只能 readFileSync。属测试期工具，不进浏览器产物
      "tests/playground/text-selection-guard.test.ts",
      // 退场实现守卫需要**递归遍历 template/ 与 apps/ 的源文件**做机械核对：
      // 判据对象是「这套符号不许出现在任何源文件里」，只能靠扫盘枚举，
      // 用 `?raw` 静态导入等于事先列出白名单（新增文件自动漏检）。
      // 属测试期工具，不进浏览器产物
      "tests/template/no-page-registry.test.ts",
      // 硬编码名守卫：同理**递归遍历 template/ 与 apps/ 的源文件**做机械核对
      // （列名/工程名/槽名散落各处，只能扫盘枚举；且要报 文件:行号）。
      // 属测试期工具，不进浏览器产物
      "tests/template/no-hardcoded-names.test.ts",
      // 屏幕域退场守卫：同理**递归遍历 template/ 、apps/ 与 packages/ui/src/ 的源文件**
      // 做机械核对（判据对象是「这套符号不许出现在任何源文件里」，只能扫盘枚举；
      // `?raw` 静态导入等于事先列白名单，新增文件自动漏检）。
      // 属测试期工具，不进浏览器产物
      "tests/template/no-screen-domain.test.ts",
      // 舞台适配守卫要**读模板样式表**核对「响应式单位只许出现在 UI 层」；
      // `?raw` 导入 `.css` 在 vitest（css:false）下被 stub 成空串，
      // 断言会退化成「找不到」而不是「没写」⇒ 只能 readFileSync。
      // 属测试期工具，不进浏览器产物
      "tests/template/stage-fit.test.ts",
      // 模板副本守卫要**先按发布链同一份脚本造出副本再逐字节比对**：
      // 副本是 gitignore 的构建产物，干净检出里不存在，只读现成目录的话
      // 本地绿、CI 必红。造副本要走子进程跑同步脚本，读文件要走 fs。
      // 属测试期工具，不进浏览器产物
      "tests/template/template-copies.test.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
);
