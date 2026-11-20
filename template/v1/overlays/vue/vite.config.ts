/**
 * Vite 配置（Vue 形态）：在骨架配置上多一个 Vue 插件，其余逐项保留。
 *
 * 资源根仍是无条件镜像 `Resources`——纯 Web 工程就是「浏览器游戏模式」的交付正例，
 * 不引入壳侧的开关判定（那属于 Tauri 壳的交付形态，见引擎仓库 `apps/playground`）。
 *
 * 字体清单、故事清单与语言清单的扫描实现在骨架的 `vite.plugins.ts`，本层只多挂一个框架插件：
 * 清单规则一处维护，换框架不该换掉「清单来自磁盘」这件事。
 */
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import {
  langListVirtual,
  storyFontsVirtual,
  storyListVirtual,
} from "./vite.plugins.ts";

/** 脚手架工程的 Vite 配置（Vue 形态） */
export default defineConfig({
  // 项目资源根即静态根：故事里的逻辑路径 `Audio/x.mp3` 解析为 `/Audio/x.mp3`，
  // 开发与打包产物一致，不依赖进程工作目录。资源根之外无隐式查找路径。
  publicDir: "Resources",

  // 宿主端口与 Tauri 约定一致；换平台壳时只改这里
  server: { port: 1420, strictPort: true },

  // 移动端兼容：构建语法目标 safari13（老 WebView 基线 Safari 13.1+/Chrome 85+ 可解析）。
  // esbuild 只转语法不补内建方法——内建由 eslint 守卫兜底。
  build: { target: "safari13" },

  plugins: [vue(), storyFontsVirtual(), storyListVirtual(), langListVirtual()],
});
