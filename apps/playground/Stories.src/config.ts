/**
 * Stories.src 配置清单（源约定：本目录根级唯一 .ts）。
 *
 * folders：参与构建的故事目录（递归扫描，凡含 default 导出函数的文件即一列）。
 * start：入口故事文件名——按文件名跨所有目录全局查找，恰好命中一个故事，否则构建期报错。
 */
export default {
  folders: ["chapter1", "chapter2", "chapter3", "chapter4"],
  start: "start.ts",
};
