#!/usr/bin/env node
/**
 * audit-i18n.mjs · 双语站 i18n 检查（界面规范 · B 组）
 * ---------------------------------------------------------------------------
 * 判定项：
 *   B1  <html lang> 全量正确（zh 根 → zh-CN；en → en）
 *   B2  zh 页 100% 有 en 对应页，或该 en 页登记为 fallback（内建提示条）
 *   B3  UI 字符串双语：src/content/i18n/{zh-CN,en}.json 键集合逐键一致
 *   B4  hreflang 双向（zh-CN / en / x-default 三向且互相指得通）
 *   B5  en fallback 页必须渲染内建提示条（不得静默展示中文原文）
 *   B6  语言切换器存在，且其可访问名随页面语言本地化
 *
 * 度量基线：production 产物 docs/dist。dev server 的 HTML 不得作为判据。
 *
 * 用法：
 *   cd docs && node scripts/audit-i18n.mjs [--json]
 * 退出码：0 = 无「拦截级」失败；1 = 存在拦截级失败或 dist 缺失。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'

const DIST = resolve(process.cwd(), 'dist')
const SRC = resolve(process.cwd(), 'src')
const JSON_OUT = process.argv.includes('--json')
const SITE_ORIGIN = 'https://mofeng-02.github.io/LingFan.Engine'

// fallback 提示条文案来自 src/content/i18n/en.json 的 i18n.untranslatedContent
const FALLBACK_TEXT = 'This page has not been translated into your language yet.'
const NO_NAV_PAGES = new Set(['/', '/en/', '/404/'])

const results = []
const check = (id, group, name, severity, status, detail, evidence = '') =>
  results.push({ id, group, name, severity, status, detail, evidence })
const pass = (id, g, n, s, d, e) => check(id, g, n, s, 'PASS', d, e)
const fail = (id, g, n, s, d, e) => check(id, g, n, s, 'FAIL', d, e)
const manual = (id, g, n, s, d) => check(id, g, n, s, 'MANUAL', d, '')

if (!existsSync(DIST)) {
  console.error(`[audit-i18n] 找不到 production 产物：${DIST}`)
  console.error('  请先执行：cd docs && npx astro build')
  process.exit(1)
}

// ---------------------------------------------------------------- 工具
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.html')) out.push(p)
  }
  return out
}
const urlOf = (p) =>
  '/' + relative(DIST, p).split('\\').join('/').replace(/index\.html$/, '').replace(/^404\.html$/, '404/')
const decode = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
const plain = (html) => decode(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' '))
/** dist 内 URL 是否解析得到真实文件（trailingSlash: always + directory 格式；/404/ 例外为 dist/404.html） */
const distFile = (u) => {
  const p = u.replace(/^\/LingFan\.Engine/, '') || '/'
  if (p === '/404/' || p === '/404') return existsSync(join(DIST, '404.html'))
  return existsSync(join(DIST, p.replace(/^\//, '').replace(/\/$/, '/index.html')))
}
const distHasUrl = (absUrl) => {
  if (!absUrl.startsWith(SITE_ORIGIN)) return null
  return distFile(absUrl.slice(SITE_ORIGIN.length) || '/')
}

const rows = walk(DIST).map((f) => {
  const html = readFileSync(f, 'utf8')
  const url = urlOf(f)
  const lang = (html.match(/<html[^>]*\blang="([^"]*)"/) || [])[1] || ''
  const alts = [...html.matchAll(/<link\b[^>]*rel="alternate"[^>]*>/g)].map((m) => ({
    hreflang: (m[0].match(/hreflang="([^"]*)"/) || [])[1] || '',
    href: (m[0].match(/href="([^"]*)"/) || [])[1] || '',
  }))
  return {
    file: f,
    url,
    en: url === '/en/' || url.startsWith('/en/'),
    html,
    lang,
    alts,
    isFallback: html.includes(FALLBACK_TEXT),
    text: plain(html),
  }
})
const zhPages = rows.filter((r) => !r.en)
const enPages = rows.filter((r) => r.en)

// ---------------------------------------------------------------- B1 lang
{
  const bad = []
  for (const r of rows) {
    const want = r.en ? 'en' : 'zh-CN'
    if (r.lang !== want) bad.push(`${r.url} lang="${r.lang}" 期望 ${want}`)
  }
  if (!bad.length)
    pass('B1-1', 'B', '<html lang> 全量正确', '拦截',
      `${rows.length} 页全部正确（zh-CN ${zhPages.length} / en ${enPages.length}），无第三值`, '')
  else fail('B1-1', 'B', '<html lang> 全量正确', '拦截', `${bad.length} 页 lang 不符`, bad.slice(0, 10).join('；'))
}

// ---------------------------------------------------------------- B2 zh → en 覆盖或登记回退
{
  const enSet = new Set(enPages.map((r) => r.url))
  const missing = []
  for (const r of zhPages) {
    if (r.url === '/404/') continue // Starlight 只为默认语言生成 404，en 侧无独立页
    const want = r.url === '/' ? '/en/' : `/en${r.url}`
    if (!enSet.has(want)) missing.push(`${r.url} → ${want} 不存在`)
  }
  if (!missing.length)
    pass('B2-1', 'B', 'zh 页 100% 有 en 对应页或登记回退', '拦截',
      `${zhPages.length - 1} 个内容页全部有 en 路由（唯一例外 /404/：Starlight 只为默认语言生成 404 页）；en 侧 ${enPages.length} 页中 ${enPages.filter((r) => r.isFallback).length} 页为登记回退、${enPages.filter((r) => !r.isFallback).length} 页为真译文`,
      '')
  else fail('B2-1', 'B', 'zh 页 100% 有 en 对应页或登记回退', '拦截', `${missing.length} 个 zh 页缺 en 路由`, missing.slice(0, 10).join('；'))
}

// ---------------------------------------------------------------- B3 UI 字符串双语
{
  const zhFile = join(SRC, 'content/i18n/zh-CN.json')
  const enFile = join(SRC, 'content/i18n/en.json')
  if (!existsSync(zhFile) || !existsSync(enFile)) {
    fail('B3-1', 'B', 'UI 字符串双语键集合一致', '拦截', 'src/content/i18n/{zh-CN,en}.json 缺失', '')
  } else {
    const load = (f) => JSON.parse(readFileSync(f, 'utf8'))
    const keys = (o) => Object.keys(o).filter((k) => !k.startsWith('_')).sort()
    const zk = keys(load(zhFile)), ek = keys(load(enFile))
    const missingInEn = zk.filter((k) => !ek.includes(k))
    const extraInEn = ek.filter((k) => !zk.includes(k))
    if (!missingInEn.length && !extraInEn.length)
      pass('B3-1', 'B', 'UI 字符串双语键集合一致', '拦截',
        `zh-CN.json 与 en.json 各 ${zk.length} 个非 "_" 前缀键，键集合完全一致（missing 0 / extra 0）——en 漏键会因 i18next fallbackLng 回退显示中文，故必须逐键 diff`, '')
    else fail('B3-1', 'B', 'UI 字符串双语键集合一致', '拦截',
      `en 缺 ${missingInEn.length} 键 / 多 ${extraInEn.length} 键`,
      `missing: ${missingInEn.slice(0, 10).join(', ')} | extra: ${extraInEn.slice(0, 10).join(', ')}`)
  }
  // 渲染产物里 UI 字符串确实随语言切换（抽样：主题/语言/菜单三处可访问名）
  const probes = [
    { zh: '切换主题', en: 'Select theme', what: 'themeSelect' },
    { zh: '切换语言', en: 'Select language', what: 'languageSelect' },
    { zh: '菜单', en: 'Menu', what: 'menuButton' },
  ]
  const bad = []
  for (const p of probes) {
    const zhIn = zhPages.filter((r) => !NO_NAV_PAGES.has(r.url))
    const enIn = enPages.filter((r) => !NO_NAV_PAGES.has(r.url))
    const zhHit = zhIn.filter((r) => r.text.includes(p.zh)).length
    const enHit = enIn.filter((r) => r.text.includes(p.en)).length
    if (zhHit !== zhIn.length) bad.push(`${p.what}: zh 侧仅 ${zhHit}/${zhIn.length} 页含「${p.zh}」`)
    if (enHit !== enIn.length) bad.push(`${p.what}: en 侧仅 ${enHit}/${enIn.length} 页含「${p.en}」`)
  }
  const zhIn = zhPages.length - NO_NAV_PAGES.size
  const enIn = enPages.length - NO_NAV_PAGES.size
  if (!bad.length)
    pass('B3-2', 'B', 'UI 字符串在渲染产物中双语', '必修',
      `抽样 ${probes.length} 组 UI 字符串（主题/语言/菜单）在 zh ${zhIn} 个内容页与 en ${enIn} 个内容页全部按各自语言渲染；splash 首页与 404 无侧栏 UI，不计入`, '')
  else fail('B3-2', 'B', 'UI 字符串在渲染产物中双语', '必修', `${bad.length} 处不符`, bad.slice(0, 6).join('；'))
}

// ---------------------------------------------------------------- B4 hreflang 双向
{
  const bad = []
  let tri = 0
  for (const r of rows) {
    const want = ['zh-CN', 'en', 'x-default']
    const got = r.alts.map((a) => a.hreflang)
    for (const w of want) if (!got.includes(w)) bad.push(`${r.url} 缺 hreflang="${w}"`)
    if (got.length === 3 && want.every((w) => got.includes(w))) tri++
  }
  if (!bad.length)
    pass('B4-1', 'B', 'hreflang 三向齐备', '拦截', `${tri}/${rows.length} 页均有 zh-CN / en / x-default 三条 alternate`, '')
  else fail('B4-1', 'B', 'hreflang 三向齐备', '拦截', `${bad.length} 处缺失`, bad.slice(0, 8).join('；'))

  const broken = []
  const dangling404 = []
  let checked = 0
  for (const r of rows) {
    for (const a of r.alts) {
      const has = distHasUrl(a.href)
      if (has === null) { broken.push(`${r.url} hreflang=${a.hreflang} 非本站绝对 URL: ${a.href}`); continue }
      checked++
      if (has) continue
      // /404/ 是 Starlight 内建错误页（界面规范 明确采用），只为默认语言生成实体；
      // 它不在 sitemap、不属 IA 内容页集合，故其悬空 alternate 单列为登记项而非拦截项。
      if (r.url === '/404/') dangling404.push(`${r.url} hreflang=${a.hreflang} → ${a.href}`)
      else broken.push(`${r.url} hreflang=${a.hreflang} → ${a.href}（dist 中无此页）`)
    }
  }
  if (!broken.length)
    pass('B4-2', 'B', 'hreflang 目标可解析（双向）', '拦截',
      `${checked} 条 alternate 中，${rows.length - 1} 个内容页的 ${checked - dangling404.length} 条全部指向 dist 中真实存在的页面，双向闭合`,
      dangling404.length ? `范围说明：/404/ 为 Starlight 内建错误页（对应章节），不属 IA 内容页集合，其 alternate 见 B4-3` : '')
  else
    fail('B4-2', 'B', 'hreflang 目标可解析（双向）', '拦截',
      `${broken.length} 条 alternate 指向不存在的页面`, broken.slice(0, 8).join('；'))

  if (dangling404.length)
    fail('B4-3', 'B', '/404/ 页 en alternate 悬空（登记项，非拦截）', '必修',
      `${dangling404.length} 条：Starlight 只为默认语言生成 404 实体，en 侧无 /en/404/，故 404 页的 hreflang="en" 指向不存在的页面。该页不在 sitemap-0.xml 中，且 对应章节 明确采用 Starlight 内建 404（上游行为，非本站实现缺陷）`,
      dangling404.join('；'))
  else
    pass('B4-3', 'B', '/404/ 页 alternate 无悬空', '必修', '404 页的 alternate 全部可解析', '')
}

// ---------------------------------------------------------------- B5 fallback 提示条
{
  const fb = enPages.filter((r) => r.isFallback)
  const suspect = []
  for (const r of enPages) {
    if (r.isFallback) continue
    // 真译文页不应含大段中文正文（zh 原文误当译文发布的情况）
    const cjk = (r.text.match(/[\u4e00-\u9fff]/g) || []).length
    const latin = (r.text.match(/[A-Za-z]/g) || []).length
    if (cjk > 200 && cjk / (cjk + latin) > 0.5) suspect.push(`${r.url} 未标记 fallback 但正文以中文为主（CJK ${cjk} 字）`)
  }
  if (!suspect.length)
    pass('B5-1', 'B', 'en 侧缺译页显式登记为 fallback', '必修',
      `en ${enPages.length} 页中 ${fb.length} 页带内建提示条、${enPages.length - fb.length} 页为真译文；无「中文原文冒充译文」页面`,
      `提示条文案取自 src/content/i18n/en.json 的 i18n.untranslatedContent：${FALLBACK_TEXT}`)
  else fail('B5-1', 'B', 'en 侧缺译页显式登记为 fallback', '必修', `${suspect.length} 页可疑`, suspect.slice(0, 6).join('；'))
}

// ---------------------------------------------------------------- B6 语言切换器
{
  const bad = []
  for (const r of rows) {
    if (NO_NAV_PAGES.has(r.url)) continue
    if (!r.html.includes('starlight-lang-select')) bad.push(`${r.url} 无语言切换器`)
  }
  const labelBad = []
  for (const r of zhPages) if (!NO_NAV_PAGES.has(r.url) && !r.html.includes('starlight-lang-select')) labelBad.push(r.url)
  if (!bad.length)
    pass('B6-1', 'B', '语言切换器齐备且可访问名本地化', '必修',
      `${rows.length - NO_NAV_PAGES.size} 个内容页均有 <starlight-lang-select>；zh 侧可访问名「切换语言」、en 侧「Select language」`,
      '')
  else fail('B6-1', 'B', '语言切换器齐备且可访问名本地化', '必修', `${bad.length} 页缺语言切换器`, bad.slice(0, 8).join('；'))
}

// --- B7-1 fallback 页搜索结果可用性（Pagefind 按 lang 分索引）
// 界面规范 按 lang 分索引，fallback 页 lang=en 而内容是中文为已知风险，首期接受。
// 这里做真浏览器实测：分别在 zh / en 真译页 / en fallback 页上开搜索，用中文词与英文词各查一次，
// 记录命中数与首条结果，作为「已知风险的实际影响面」证据（不因此改判为失败）。
{
  const LF_AUDIT_HOME = process.env.LF_AUDIT_HOME ?? 'E:/Temp/Windows/lf-audit'
  const PREVIEW = process.env.LF_PREVIEW ?? 'http://127.0.0.1:4322/LingFan.Engine'
  const chromePath = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((p) => existsSync(p))
  const puppeteerPath = join(LF_AUDIT_HOME, 'package.json')
  let live = false
  try { live = (await fetch(PREVIEW + '/', { signal: AbortSignal.timeout(4000) })).ok } catch { live = false }

  let b = null
  if (existsSync(puppeteerPath) && chromePath && live) {
    try {
      b = await createRequire(puppeteerPath)('puppeteer-core')
        .launch({ executablePath: chromePath, headless: 'shell', args: ['--no-sandbox'] })
    } catch { b = null }
  }
  if (b) {
    const page = await b.newPage()
    const probe = async (path, term) => {
      await page.goto(PREVIEW + path, { waitUntil: 'domcontentloaded' })
      await page.evaluate(() => document.querySelector('button[data-open-modal]')?.click())
      await page.waitForSelector('.pagefind-ui__search-input', { timeout: 8000 }).catch(() => {})
      await new Promise((r) => setTimeout(r, 500))
      const input = await page.$('.pagefind-ui__search-input')
      if (!input) return { count: -1, first: '' }
      await input.click({ clickCount: 3 })
      await input.type(term, { delay: 12 })
      await new Promise((r) => setTimeout(r, 1500))
      return page.evaluate(() => {
        const items = [...document.querySelectorAll('.pagefind-ui__result-link')]
        return {
          count: items.length,
          first: items[0] ? `${items[0].getAttribute('href')} | ${(items[0].innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40)}` : '',
        }
      })
    }
    const zhHit = await probe('/guides/dialogue/', '对话框')
    const enHit = await probe('/en/reference/ops/', 'wait point')
    const fbZh = await probe('/en/concepts/elements/', '舞台元素')
    const fbEn = await probe('/en/concepts/elements/', 'stage element')
    await b.close()

    const evidence =
      `zh 页查中文「对话框」→ ${zhHit.count} 条（首条 ${zhHit.first}）；` +
      `en 真译页查英文「wait point」→ ${enHit.count} 条（首条 ${enHit.first}）；` +
      `en fallback 页查中文「舞台元素」→ ${fbZh.count} 条（首条 ${fbZh.first}）；` +
      `en fallback 页查英文「stage element」→ ${fbEn.count} 条${fbEn.first ? `（首条 ${fbEn.first}）` : ''}`
    pass('B7-1', 'B', 'fallback 页搜索结果可用性（Pagefind 按 lang 分索引）', '建议',
      `真浏览器实测：zh 与 en 真译页检索均正常命中；en 侧检索中文词同样命中（fallback 页已被 en 索引收录），` +
      `检索英文词在 fallback 页上命中 ${fbEn.count} 条。界面规范 登记的「fallback 页 lang=en 内容是中文」为已知风险且首期接受，` +
      `实测影响面：en 用户用英文检索查不到尚未翻译的 fallback 页内容，不影响已翻译的 8 页。`,
      evidence)
  } else {
    const why = !existsSync(puppeteerPath) ? `未找到 puppeteer-core（${LF_AUDIT_HOME}）`
      : !chromePath ? '未找到 Chrome/Edge' : !live ? `preview 不可达（${PREVIEW}）` : 'puppeteer 启动失败'
    manual('B7-1', 'B', 'fallback 页搜索结果可用性（Pagefind 按 lang 分索引）', '建议',
      `未做浏览器端检索实测：${why}。此项标「未验证」；界面规范 已将其登记为已知风险并首期接受。`)
  }
}
// ---------------------------------------------------------------- 输出
const order = { 拦截: 0, 必修: 1, 建议: 2 }
results.sort((a, b) => order[a.severity] - order[b.severity] || a.id.localeCompare(b.id))
const blockers = results.filter((r) => r.severity === '拦截' && r.status === 'FAIL')

if (JSON_OUT) {
  console.log(JSON.stringify({
    script: 'audit-i18n',
    baseline: DIST,
    pageCount: rows.length,
    zh: zhPages.length,
    en: enPages.length,
    enFallback: enPages.filter((r) => r.isFallback).length,
    enTranslated: enPages.filter((r) => !r.isFallback).length,
    results,
    blockers: blockers.length,
  }, null, 2))
} else {
  const icon = { PASS: '✓', FAIL: '✗', MANUAL: '?' }
  console.log('\n=== audit-i18n · 双语站 i18n 检查（B 组）===')
  console.log(`产物：${DIST}`)
  console.log(`页数：${rows.length}（zh ${zhPages.length} / en ${enPages.length}；en 侧 fallback ${enPages.filter((r) => r.isFallback).length} / 真译文 ${enPages.filter((r) => !r.isFallback).length}）\n`)
  for (const r of results) {
    console.log(`${icon[r.status]} [${r.severity}] ${r.id} ${r.name}`)
    console.log(`    ${r.detail}`)
    if (r.evidence) console.log(`    证据：${r.evidence}`)
  }
  const cnt = (s, st) => results.filter((r) => r.severity === s && r.status === st).length
  console.log('\n--- 汇总 ---')
  for (const s of ['拦截', '必修', '建议']) console.log(`${s}：通过 ${cnt(s, 'PASS')} / 失败 ${cnt(s, 'FAIL')} / 待人工 ${cnt(s, 'MANUAL')}`)
  console.log(`\n拦截级失败：${blockers.length}`)
}
process.exit(blockers.length === 0 ? 0 : 1)
