import eslintConfigPrettier from "eslint-config-prettier";
import {
  defineConfigWithVueTs,
  vueTsConfigs,
} from "@vue/eslint-config-typescript";
import pluginVue from "eslint-plugin-vue";

/**
 * 边界规则（no-restricted-imports）**按文件域互斥拆分**：flat config 同名规则
 * 后块覆盖前块——若文件域重叠，只有最后一个块生效（曾因此让 vue/@tauri/node
 * 三组禁令对引擎核心静默失效，探针实测逮住）。每个文件域只允许命中一个块。
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
      "**/.tmp-build/**",
      // 私有文档（设计稿/验收脚本/临时探针）：已入 .gitignore 不随仓库分发，
      // 其中 .cjs 探针按 CommonJS 写(require)，与本仓 TS 源的模块规范不同
      "**/私有文档/**",
      // stories:build 的 cell 生成物（fun_register.g.ts）：实现文本从源原样搬运，
      // 缩进/风格由生成器负责——入库但免检（.prettierignore 已同步）
      "**/Stories.src/gen/**",
    ],
  },
  pluginVue.configs["flat/essential"],
  vueTsConfigs.recommended,
  eslintConfigPrettier,
  {
    name: "lingfan/allow-single-word-app",
    files: ["apps/playground/src/App.vue", "apps/editor/src/App.vue"],
    rules: {
      "vue/multi-word-component-names": "off",
    },
  },
  {
    name: "lingfan/core-boundaries",
    // 核心层框架无关——可用 Web 标准 API，禁止 UI 框架 / Tauri API / Node
    // packages/editor（编辑器核心，纯映射器）与 tests/engine|editor/**（集中测试目录）
    // 测试同样受核心层边界约束（测试集中化）
    files: [
      "packages/engine/**/*.{ts,vue}",
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
              message:
                "核心层框架无关：禁止 import UI 框架与 Tauri API",
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
    // 老 WebView 内建方法守卫：基线 = Safari 13.1+ / Chrome 85+（Android 9 镜像 Chrome 91 实测）——
    // replaceAll（Chrome 85/Safari 13.1 起支持）在基线内合法，不在守卫之列；
    // 只拦基线之后的内建方法/全局（Chrome 92+ 一族 + Safari 15 才有的 Promise.any），
    // 命中即老 WebView TypeError → 模块执行中断 → #app 空 → 白屏。
    // 语法层兼容由 vite build.target=safari13 负责（esbuild 不补内建方法，守卫在这里）。
    files: ["packages/**/*.ts", "apps/*/src/**/*.{ts,vue}"],
    rules: {
      "no-restricted-syntax": [
        "error",
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
          selector: "MemberExpression[object.name='Array'][property.name='fromAsync']",
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
          selector: "MemberExpression[object.name='AbortSignal'][property.name='timeout']",
          message:
            "AbortSignal.timeout 需 Chrome 103+/Safari 16+，基线不含——用 AbortController + setTimeout 替代",
        },
        {
          selector: "MemberExpression[object.name='crypto'][property.name='randomUUID']",
          message:
            "crypto.randomUUID 需 Chrome 92+/Safari 15.4+，基线不含——用 crypto.getRandomValues 手写 UUID 替代",
        },
      ],
      "no-restricted-globals": [
        "error",
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
      ],
    },
  },
  {
    name: "lingfan/node-side-tooling",
    // TS 故事源管线是 Node 侧创作期工具（tsx 运行）——其脚本与测试需要
    // node:fs 等（不在 WebView 运行，不受「WebView 无 Node」守卫；编辑器/引擎/Rust 零感知）
    files: [
      "apps/playground/scripts/**/*.{ts,mjs}",
      "tests/playground/stories-build.test.ts",
      // 编辑器的**本地服务宿主**（B4：仅回环 HTTP + 外部打开）——
      // Node 侧运行，浏览器端代码零感知（前端只做能力探测，不假设它在）
      "apps/editor/server/**/*.ts",
      "tests/editor/server-*.test.ts",
      // token 守卫（B5）需要**读编辑器源码**做机械核对（扫裸色值/裸字号）
      // —— 属测试期工具，不进浏览器产物
      "tests/editor/token-guard.test.ts",
      // 诊断面板类名隔离守卫：同理**读全部组件模板**做跨组件撞名核对
      // （实测撞名会让选择器/探针指向别的面板，症状是「功能坏了」的误判）
      "tests/editor/diagnostics-css-isolation.test.ts",
      // 纯图标按钮 a11y 守卫：同理**读全部组件模板**做 aria-label 核对
      // （title 不进无障碍树 ⇒ 纯图标按钮无aria-label = 对读屏用户不存在）
      "tests/editor/aria-label-guard.test.ts",
      // 真实工程形态验证（用户实测工程 E:\langf\Downloads\Demo\Test\Resources）：
      // 需**读仓外真实工程**核对三Lang 布局与场景类型分布 —— 属测试期工具
      "tests/engine/data/real-project-scene-type.test.ts",
      // 真实工程**端到端打开**守卫：同理读仓外真实工程（用户实测工程），
      // 验「四个阻塞全解除」——组装成功 / 类型识别 / 编排保住 / 无拍平产物
      "tests/engine/data/real-project-open.test.ts",
      // Script 词汇层互锁守卫：读词汇层源文件做「登记 ↔ 导出」一致性核对（测试期工具）
      "tests/editor/script-vocabulary.test.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
);
