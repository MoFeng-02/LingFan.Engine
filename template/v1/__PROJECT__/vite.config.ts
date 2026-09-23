import { defineConfig } from "vite";

export default defineConfig({
  // 08-U7：项目资源根即静态根 —— 故事里的逻辑路径 `Audio/x.mp3` 解析为 `/Audio/x.mp3`，
  // 开发与打包产物一致，不依赖进程工作目录。资源根之外无隐式查找路径。
  publicDir: "Resources",

  // 宿主端口与 Tauri 约定一致；换平台壳时只改这里
  server: { port: 1420, strictPort: true },
});
