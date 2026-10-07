import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// 编辑器为浏览器应用（加载/导出走文件导入导出）；Tauri 桌面化随项目与发布阶段接入
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 1425,
    // 本地宿主（`pnpm --filter @lingfan/editor-app host`）在**独立进程**里跑，
    // 开发期经此代理把「能力探测 / 外部打开 / 文件枚举」转发过去 ⇒ 前端同源调用即可。
    // 目标端口与 `server/main.ts` 的 `PORT` 固定值一致（生产期用内核分配端口，
    //   那时前端拿到的是构建期注入的基址，不走此代理）。
    proxy: {
      "/__editor_host__": { target: "http://127.0.0.1:14250", changeOrigin: false },
      "/__host__": { target: "http://127.0.0.1:14250", changeOrigin: false },
    },
  },
});
