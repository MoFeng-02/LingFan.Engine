/**
 * audit-redline 模块组合根。
 * 全部使用 await import 串行加载：checks-browser 与 checks-axe 含顶层 await
 * （fetch/puppeteer），若用静态 import，兄弟模块的求值不会被其阻塞，
 * report.ts 的 process.exit() 会在挂起的顶层 await 续体被恢复前终止进程。
 * 静态 import 对无顶层 await 的模块等价；这里统一用 await import，
 * 保证兄弟模块的求值顺序串行且确定。
 */
await import("./shared.ts");
await import("./checks-tokens.ts");
await import("./checks-brand.ts");
await import("./checks-browser.ts");
await import("./checks-apply.ts");
await import("./checks-typography.ts");
await import("./checks-leech.ts");
await import("./checks-axe.ts");
await import("./report.ts");
