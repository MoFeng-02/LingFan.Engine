/**
 * audit-i18n · 组合根（唯一出口）。
 *
 * 入口 audit-i18n.mjs 只 import 本文件；四个实现模块按下列顺序求值：
 * 共享配置与产物扫描 → B1-B6 → B7 → 输出。
 *
 * 注意：这里必须用 await import() 而不是静态 import——
 * 含顶层 await 的模块（checks-browser 的 fetch/puppeteer）作为静态
 * sibling 不会阻塞后续模块求值，report 的 process.exit 会把它掐断。
 */
await import("./shared.ts");
await import("./checks-core.ts");
await import("./checks-browser.ts");
await import("./report.ts");
