import { defineConfig } from "vite";
import {
  langListVirtual,
  storyFontsVirtual,
  storyListVirtual,
} from "./vite.plugins.ts";

/**
 * 脚手架工程的 Vite 配置：约定资源根、宿主端口与三个清单虚拟模块。
 *
 * 字体清单、故事清单与语言清单都由构建期扫描资源根得出（实现见 `vite.plugins.ts`）——
 * 加一个故事文件、放一个字体、加一个语言目录，不需要回来改任何名单。
 */
export default defineConfig({
  // 项目资源根即静态根 —— 故事里的逻辑路径 `Audio/x.mp3` 解析为 `/Audio/x.mp3`，
  // 开发与打包产物一致，不依赖进程工作目录。资源根之外无隐式查找路径。
  publicDir: "Resources",

  // 宿主端口与 Tauri 约定一致；换平台壳时只改这里
  server: { port: 1420, strictPort: true },

  // 移动端兼容：构建语法目标 safari13（老 WebView 基线 Safari 13.1+/Chrome 85+ 可解析）。
  // esbuild 只转语法不补内建方法（如 Array.prototype.at）——内建由 eslint 守卫兜底。
  build: { target: "safari13" },

  plugins: [storyFontsVirtual(), storyListVirtual(), langListVirtual()],
});
