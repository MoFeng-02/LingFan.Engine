#!/usr/bin/env node
/**
 * audit-ia.mjs · 信息架构与响应式检查
 * ---------------------------------------------------------------------------
 * 覆盖以下检查项：
 *   信息架构
 *     - 侧栏与既定信息架构 1:1：分组数 / 分组顺序 / 分组标签 / 必备页归属
 *     - 内部断链 0（含 #锚点级）
 *     - 侧栏不平铺：单分组直接子项 ≤12；参考区深度 ≥2
 *     - URL 规则：zh 无前缀 / en 走 /en/、全英文 kebab-case slug、trailingSlash always
 *     - op 参考：9 个域页齐备、内建 op 锚点全覆盖且不重复（名单取自引擎的 BUILTIN_OP_NAMES）、总览只链实际存在的域页
 *   响应式
 *     - 320 / 375 / 768 / 1024 / 1440 五档无页面级横向滚动
 *     - 移动菜单焦点管理（打开时主内容 inert、Escape 关闭并恢复）
 *
 * 度量基线：production 产物 docs/dist（`astro build` 输出）。dev server 的 HTML
 * 与 dist 不同，不得作为判据。
 *
 * 浏览器项需要 puppeteer-core + 本机 Chrome：探测不到时降级为 MANUAL
 * 并在报告中显式标「未验证」，绝不静默判过。
 *
 * 用法：
 *   cd docs && node scripts/audit-ia.mjs           # 人类可读
 *   cd docs && node scripts/audit-ia.mjs --json    # 机器可读（报告用）
 * 退出码：0 = 无「拦截级」失败；1 = 存在拦截级失败或 dist 缺失。
 *
 * 实现位于 ./audit-ia/ 子目录（index.ts 为唯一出口），本入口只负责加载：
 */
import "./audit-ia/index.ts";
