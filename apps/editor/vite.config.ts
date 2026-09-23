import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// 编辑器为浏览器应用（加载/导出走文件导入导出）；Tauri 桌面化随 01 §一.1.6 项目与发布阶段接入
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 1425,
  },
});
