#!/usr/bin/env node
/**
 * audit-frontmatter.mjs · 逐页 head 与文档结构检查
 * ---------------------------------------------------------------------------
 * 覆盖以下检查项：
 *   A 组 · 信息架构（title 唯一且 ≤60、description ≤160 且 100% 覆盖、canonical/OG）
 *   E 组 · 无障碍（每页恰一个 h1、标题层级不跳级、landmark、装饰性 SVG、alt、焦点序、键盘走查）
 *   H 组 · 反模板感（每页 title 含站名）
 *
 * 度量基线：production 产物 docs/dist（`astro build` 输出）。dev server 的 HTML
 * 与 dist 不同，不得作为判据。
 *
 * 用法：
 *   cd docs && node scripts/audit-frontmatter.mjs          # 人类可读
 *   cd docs && node scripts/audit-frontmatter.mjs --json    # 机器可读（报告用）
 * 退出码：0 = 无「拦截级」失败；1 = 存在拦截级失败或 dist 缺失。
 *         「必修 / 建议」级问题只记录，不改变退出码（发布门禁 = 拦截级通过）。
 *
 * 实现位于 ./audit-frontmatter/ 子目录（index.ts 为唯一出口），本入口只负责加载：
 */
import "./audit-frontmatter/index.ts";
