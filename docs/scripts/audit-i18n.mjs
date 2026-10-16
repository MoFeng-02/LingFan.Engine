#!/usr/bin/env node
/**
 * audit-i18n.mjs · 双语站 i18n 检查
 * ---------------------------------------------------------------------------
 * 判定项：
 *   B1  <html lang> 全量正确（zh 根 → zh-CN；en → en）
 *   B2  zh 页 100% 有 en 对应页，或该 en 页登记为 fallback（内建提示条）
 *   B3  UI 字符串双语：src/content/i18n/{zh-CN,en}.json 键集合逐键一致
 *   B4  hreflang 双向（zh-CN / en / x-default 三向且互相指得通）
 *   B5  en fallback 页必须渲染内建提示条（不得静默展示中文原文）
 *   B6  语言切换器存在，且其可访问名随页面语言本地化
 *   B7  fallback 页搜索结果可用性（Pagefind 按 lang 分索引）
 *
 * 度量基线：production 产物 docs/dist。dev server 的 HTML 不得作为判据。
 *
 * 用法：
 *   cd docs && node scripts/audit-i18n.mjs [--json]
 * 退出码：0 = 无「拦截级」失败；1 = 存在拦截级失败或 dist 缺失。
 *
 * 实现位于 ./audit-i18n/ 子目录（index.ts 为唯一出口），本入口只负责加载：
 */
import "./audit-i18n/index.ts";
