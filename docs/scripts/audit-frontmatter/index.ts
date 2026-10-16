/**
 * audit-frontmatter · 组合根（唯一出口）。
 *
 * 入口 audit-frontmatter.mjs 只 import 本文件；五个实现模块按下列顺序求值：
 * 共享配置与产物扫描 → head 与信息架构 → 静态结构 →
 * 键盘走查（浏览器）→ 输出。
 *
 * 注意：这里必须用 await import() 而不是静态 import——
 * 含顶层 await 的模块（checks-browser 的 fetch/puppeteer）作为静态
 * sibling 不会阻塞后续模块求值，report 的 process.exit 会把它掐断。
 */
await import("./shared.ts");
await import("./checks-head.ts");
await import("./checks-structure.ts");
await import("./checks-browser.ts");
await import("./report.ts");
