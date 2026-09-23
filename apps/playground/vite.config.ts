import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
// @ts-expect-error type error without @types/node package
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
}));
