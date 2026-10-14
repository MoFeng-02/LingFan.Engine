#!/usr/bin/env node
/**
 * audit-redline.mjs · 内容规范 / 设计令牌 / 版式一致性 / axe 无障碍
 * ---------------------------------------------------------------------------
 * 覆盖以下检查项：
 *   C 组 · 令牌（亮暗两套、以覆盖 --sl-* 实现、不自造平行体系、
 *                 token 文件为唯一色值来源、WCAG AA 亮暗双过、中文字体栈）
 *   E 组 · 无障碍（axe critical/serious：受检集合 × 亮暗 × zh/en）
 *   G 组 · 内容合规（敏感内容零泄露、模板占位清零、站名一致、
 *                    无未实现承诺、G5 文风人工精读）
 *   H 组 · 版式一致性（默认品牌色清零【hex 等价表 + 级联层归属裁决】、
 *                     品牌标识应用、与裸 Starlight 并排差异 ≥3 处）
 *
 * 度量基线：production 产物 docs/dist（`astro build` 输出）。
 *
 * 【H1 判定方法说明】lightningcss 会把 hsl() 重编码为 hex，Starlight 默认品牌色
 * 因此仍字面存在于 dist 中，只做字面 grep 会给出假阳性失败。本脚本采用两步裁决：
 *   ① hex 等价表：由 Starlight 上游 props.css 的 hsl 声明实算 hex，逐个在 dist CSS
 *      中定位，并给出每处的 @layer 归属与媒体上下文；
 *   ② 级联层归属裁决：栈式扫描 @layer 块边界，对 --sl-color-accent{,-low,-high} 与
 *      --sl-hue-* 的全部声明按「未分层 > 分层，同层内后者胜」求屏幕态有效声明，
 *      证明自定义声明恒胜 Starlight 默认值；
 *   ③ 浏览器复核：读取 getComputedStyle 的解析值，直接证伪默认品牌色生效。
 *
 * 用法：
 *   cd docs && node scripts/audit-redline.mjs           # 人类可读
 *   cd docs && node scripts/audit-redline.mjs --json     # 机器可读（报告用）
 * 退出码：0 = 无「拦截级」失败；1 = 存在拦截级失败或 dist 缺失。
 */

import "./audit-redline/index.ts";
