import eslintConfigPrettier from "eslint-config-prettier";
import {
  defineConfigWithVueTs,
  vueTsConfigs,
} from "@vue/eslint-config-typescript";
import pluginVue from "eslint-plugin-vue";

export default defineConfigWithVueTs(
  {
    name: "lingfan/files-to-lint",
    files: ["**/*.{ts,mts,tsx,vue}"],
  },
  {
    name: "lingfan/files-to-ignore",
    ignores: ["dist/**", "coverage/**", "src-tauri/**"],
  },
  pluginVue.configs["flat/essential"],
  vueTsConfigs.recommended,
  eslintConfigPrettier,
  {
    name: "lingfan/allow-single-word-app",
    files: ["src/App.vue"],
    rules: {
      "vue/multi-word-component-names": "off",
    },
  },
  {
    name: "lingfan/core-boundaries",
    // 规约 00 §3.2-1：核心层框架无关——可用 Web 标准 API，禁止 UI 框架与 Tauri API
    files: ["src/engine/**/*.ts"],
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
            {
              group: ["node:*", "fs", "path", "os", "child_process"],
              message:
                "WebView 里没有 Node（规约 00 §3.2）：文件/进程必经 Rust 命令",
            },
          ],
        },
      ],
    },
  },
  {
    name: "lingfan/webview-no-node",
    // 规约 00 §3.2-2：WebView 没有 Node——前端运行时代码禁 Node 内置模块
    files: ["src/**/*.{ts,vue}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*", "fs", "path", "os", "child_process"],
              message:
                "WebView 里没有 Node（规约 00 §3.2）：文件/进程必经 Rust 命令",
            },
          ],
        },
      ],
    },
  },
);
