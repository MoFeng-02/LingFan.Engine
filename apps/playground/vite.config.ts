import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// 浏览器游戏模式开关（构建期，正向显式）：只有置 1 才允许外部浏览器游玩本产物。
// 缺省（含一切生产构建）= 封闭：前端守卫拒绝启动（src/browserGuard.ts），且下面不镜像资源根。
// `vite dev` 恒放行（开发模式便利，也是「浏览器复用宿主能力」场景的前提）。
const isBrowserGame = process.env.VITE_LFEN_BROWSER_GAME === "1";

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [vue()],

  // 应用资源根 = 本示例工程的 Resources/（**不是**引擎资产）：
  // 故事里的逻辑路径相对资源根（`Audio/x.mp3`、`Images/y.png`、`Video/z.mp4`），
  // 故把 `Resources` 作为静态根 → 开发与打包产物都解析为 `/Audio/x.mp3`，与部署位置解耦。
  // 与脚手架 template/v1 同构；引擎核心零资源、零路径假设。
  //
  // **仅 dev 与浏览器游戏模式镜像**：`publicDir` 会把整个资源根按 URL 裸拷进产物 —— 任何人
  // 直接请求 `/Audio/x.mp3` 即可绕过应用入口扒走明文资源，与「不外泄」冲突。封闭构建不镜像，
  // 浏览器侧因此既进不去应用、也取不到资源。
  // Tauri 形态不受影响：资源由 tauri.conf.json 的 `bundle.resources` 单独打包，与 publicDir 无关。
  publicDir: command === "serve" || isBrowserGame ? "Resources" : false,

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
  // （此前此块误嵌于 server.watch 内从未生效，随构建配置调整一并归位）
  build: {
    target: "safari13",
    // 单包产物——动态 import（@tauri-apps 等）内联进入口，html 只引用一个产物文件；
    // 懒加载 chunk 的相对引用无法经构建期改写到解密协议，单包是改写面最小的形态
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
}));
