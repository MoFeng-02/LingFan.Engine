import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [vue()],

  // 08-U7 应用资源根 = 本示例工程的 Resources/（**不是**引擎资产）：
  // 故事里的逻辑路径相对资源根（`Audio/x.mp3`、`Images/y.png`、`Video/z.mp4`，照搬老引擎语义），
  // 故把 `Resources` 作为静态根 → 开发与打包产物都解析为 `/Audio/x.mp3`，与部署位置解耦。
  // 与脚手架 template/v1 同构；引擎核心零资源、零路径假设。
  publicDir: "Resources",

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  // 移动端兼容：构建语法目标按 Tauri 官方建议 = safari13（老 WebView 可解析）；
  // esbuild 只转语法不补内建方法（如 Array.prototype.at）——那是 lint 守卫的事。
  // （此前此块误嵌于 server.watch 内从未生效，随 T06-02 调整 build 配置一并归位）
  build: {
    target: "safari13",
    // T06-02：单包产物——动态 import（@tauri-apps 等）内联进入口，html 只引用一个产物文件；
    // 懒加载 chunk 的相对引用无法经构建期改写到解密协议，单包是改写面最小的形态
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
}));
