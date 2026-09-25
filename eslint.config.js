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
  message: "WebView 里没有 Node（规约 00 §3.2）：文件/进程必经 Rust 命令",
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
    "资源禁止构建期 import（08-U7）：经 ResourcePort 逻辑寻址，由平台适配器供数（可能是加密资源）",
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
      "**/coverage/**",
      "**/src-tauri/**",
      "**/node_modules/**",
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
    // 规约 00 §3.2-1：核心层框架无关——可用 Web 标准 API，禁止 UI 框架 / Tauri API / Node
    // packages/editor（06 编辑器核心，纯映射器 D1）与 tests/engine|editor/**（集中测试目录）
    // 同样受核心层边界约束（agent.md §3 测试集中化）
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
                "核心层框架无关（规约 00 §3.2）：禁止 import UI 框架与 Tauri API",
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
    // 规约 00 §3.2-2：WebView 没有 Node；08-U7：资源禁止构建期 import——
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
    // ③ 移动端兼容：目标 WebView 含 Chrome 91（Android 9 镜像，雷电实测）/ Safari 13-15——
    // Array/String.prototype.at 是 ES2022（Chrome 92+/Safari 15.4+），老 WebView 直接
    // TypeError → 模块执行中断 → #app 空 → 白屏。用 arr[arr.length - 1] 替代；
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
      ],
    },
  },
);
