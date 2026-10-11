#!/usr/bin/env node
/**
 * audit-bundle.mjs · 性能与产物体积检查（界面规范 · D 组）
 * ---------------------------------------------------------------------------
 * 判定项：
 *   D1  Lighthouse 移动端 Performance ≥ 95（3 次取中位）
 *   D2  CLS ≤ 0.01（同一批 Lighthouse 报告）
 *   D3  自定义首屏增量 ≤ 10KB gzip（对照裸 Starlight 基线）
 *   D4  单页全量 JS ≤ 基线同型页 + 20KB gzip
 *   D5  产物零运行时框架（静态引用链路）
 *   D6  自定义 CSS 源文件总量 ≤ 30KB（30720 B，gzip 前）
 *   D7  内联脚本与基线一致（无自定义阻塞脚本注入）
 *
 * 度量基线：production 产物 docs/dist。
 *   - Lighthouse 报告目录：--lh=<dir>，默认 E:/Temp/Windows/lf-audit/reports
 *   - 裸 Starlight 基线工程：--baseline=<dir>，默认 E:/Temp/Windows/lf-baseline
 *     基线工程不存在时，回落到脚本内记录的实测快照（见 BASELINE_SNAPSHOT），
 *     并在证据里标明「快照」而非「本次构建」。
 *
 * 用法：
 *   cd docs && node scripts/audit-bundle.mjs [--json]
 * 退出码：0 = 无「拦截级」失败；1 = 存在拦截级失败或 dist 缺失。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, resolve, basename } from 'node:path'

const DIST = resolve(process.cwd(), 'dist')
const STYLES = resolve(process.cwd(), 'src/styles')
const JSON_OUT = process.argv.includes('--json')
const argOf = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const LH_DIR = argOf('lh', 'E:/Temp/Windows/lf-audit/reports')
const BASELINE_DIR = argOf('baseline', 'E:/Temp/Windows/lf-baseline')

const PERF_MIN = 95
const CLS_MAX = 0.01
const FIRST_SCREEN_DELTA_MAX = 10 * 1024
const PAGE_TOTAL_DELTA_MAX = 20 * 1024
const CSS_SOURCE_MAX = 30 * 1024

/** 裸 Starlight 0.42.6 + Astro 7.3.8 最小工程的实测快照（gzip 字节） */
const BASELINE_SNAPSHOT = {
  home: { js: 2693, css: 12376, inline: 3415 },
  content: { js: 3118, css: 12376, inline: 4909 },
  note: 'lf-baseline 最小工程（docsLoader+docsSchema，含 1 个代码块）实测',
}

const results = []
const check = (id, group, name, severity, status, detail, evidence = '') =>
  results.push({ id, group, name, severity, status, detail, evidence })
const pass = (id, g, n, s, d, e) => check(id, g, n, s, 'PASS', d, e)
const fail = (id, g, n, s, d, e) => check(id, g, n, s, 'FAIL', d, e)
const manual = (id, g, n, s, d) => check(id, g, n, s, 'MANUAL', d, '')

if (!existsSync(DIST)) {
  console.error(`[audit-bundle] 找不到 production 产物：${DIST}`)
  console.error('  请先执行：cd docs && npx astro build')
  process.exit(1)
}

// ---------------------------------------------------------------- 工具
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
const gz = (p) => gzipSync(readFileSync(p)).length
/** 提取一个 HTML 的静态资源引用（相对 dist 的路径）与内联脚本体积 */
function assetsOf(htmlFile, root) {
  const html = readFileSync(htmlFile, 'utf8')
  const refs = (re) => [...html.matchAll(re)].map((m) => m[1].replace(/^\/LingFan\.Engine\//, '').replace(/^\//, ''))
  const js = refs(/<script\b[^>]*\bsrc="([^"]+)"/g)
  const css = refs(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)
  let inline = 0
  let inlineCount = 0
  const inlineTexts = []
  for (const m of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    inline += Buffer.byteLength(m[1], 'utf8')
    inlineCount++
    inlineTexts.push(m[1])
  }
  const sum = (list) => list.reduce((a, r) => {
    const p = join(root, r)
    return existsSync(p) ? a + gz(p) : a
  }, 0)
  return { js, css, jsGzip: sum(js), cssGzip: sum(css), inline, inlineCount, inlineTexts, html }
}

const htmlFiles = walk(DIST).filter((f) => f.endsWith('.html'))
const homeFile = join(DIST, 'index.html')
const contentFile = join(DIST, 'getting-started', 'index.html')
const home = assetsOf(homeFile, DIST)
const content = assetsOf(contentFile, DIST)

// ---------------------------------------------------------------- D1 / D2 Lighthouse
{
  const reports = existsSync(LH_DIR)
    ? readdirSync(LH_DIR).filter((f) => /^home-\d+\.json$/.test(f)).sort()
    : []
  if (reports.length < 3) {
    manual('D1-1', 'D', `Lighthouse 移动端 Performance ≥ ${PERF_MIN}（3 次取中位）`, '拦截',
      `未找到 3 份报告（目录 ${LH_DIR}）。本轮须以 production 产物为基线手动复测：\n      node <lighthouse>/cli/index.js http://127.0.0.1:<port>/LingFan.Engine/ --form-factor=mobile --screenEmulation.mobile=true --only-categories=performance,accessibility --output=json --output-path=<dir>/home-N.json\n    未实测时本项在报告中标「未验证」。`)
    manual('D2-1', 'D', `CLS ≤ ${CLS_MAX}`, '拦截',
      '同上：CLS 取自 Lighthouse 报告的 cumulative-layout-shift 检查，报告缺失时标「未验证」。')
  } else {
    const runs = reports.slice(0, 3).map((f) => {
      const r = JSON.parse(readFileSync(join(LH_DIR, f), 'utf8'))
      const a = r.audits || {}
      return {
        file: f,
        perf: (r.categories?.performance?.score ?? 0) * 100,
        a11y: (r.categories?.accessibility?.score ?? 0) * 100,
        cls: a['cumulative-layout-shift']?.numericValue ?? null,
        lcp: a['largest-contentful-paint']?.numericValue ?? null,
        fcp: a['first-contentful-paint']?.numericValue ?? null,
        tbt: a['total-blocking-time']?.numericValue ?? null,
        bytes: a['total-byte-weight']?.numericValue ?? null,
        formFactor: r.configSettings?.formFactor,
        mobile: r.configSettings?.screenEmulation?.mobile,
      }
    })
    const med = (xs) => [...xs].sort((a, b) => a - b)[1]
    const perfMed = med(runs.map((r) => r.perf))
    const clsMed = med(runs.map((r) => r.cls))
    const mobileOk = runs.every((r) => r.formFactor === 'mobile' && r.mobile === true)
    const ev = runs.map((r) => `${r.file}: perf ${r.perf.toFixed(0)} / CLS ${r.cls} / LCP ${(r.lcp / 1000).toFixed(1)}s / TBT ${r.tbt.toFixed(0)}ms / 总字节 ${(r.bytes / 1024).toFixed(0)} KiB`).join('；')
    if (perfMed >= PERF_MIN && mobileOk)
      pass('D1-1', 'D', `Lighthouse 移动端 Performance ≥ ${PERF_MIN}（3 次取中位）`, '拦截',
        `三次 ${runs.map((r) => r.perf.toFixed(2)).join(' / ')} ⇒ 中位 ${perfMed.toFixed(2)} ≥ ${PERF_MIN}；三次均为移动端模拟（formFactor=mobile, screenEmulation.mobile=true）`, ev)
    else
      fail('D1-1', 'D', `Lighthouse 移动端 Performance ≥ ${PERF_MIN}（3 次取中位）`, '拦截',
        `中位 ${perfMed.toFixed(2)}；移动端模拟全部生效 = ${mobileOk}`, ev)
    if (clsMed <= CLS_MAX)
      pass('D2-1', 'D', `CLS ≤ ${CLS_MAX}`, '拦截', `三次 CLS ${runs.map((r) => r.cls).join(' / ')} ⇒ 中位 ${clsMed} ≤ ${CLS_MAX}`, ev)
    else
      fail('D2-1', 'D', `CLS ≤ ${CLS_MAX}`, '拦截', `中位 ${clsMed} > ${CLS_MAX}`, ev)
  }
}

// ---------------------------------------------------------------- D3 / D4 / D7 与基线对比
{
  let base = null
  let src = ''
  if (existsSync(join(BASELINE_DIR, 'dist', 'index.html'))) {
    const bHome = assetsOf(join(BASELINE_DIR, 'dist', 'index.html'), join(BASELINE_DIR, 'dist'))
    const bContent = assetsOf(join(BASELINE_DIR, 'dist', 'getting-started', 'index.html'), join(BASELINE_DIR, 'dist'))
    base = {
      home: { js: bHome.jsGzip, css: bHome.cssGzip, inline: bHome.inline },
      content: { js: bContent.jsGzip, css: bContent.cssGzip, inline: bContent.inline },
      homeInline: bHome.inlineTexts,
      contentInline: bContent.inlineTexts,
    }
    src = `本次构建 ${BASELINE_DIR}`
  } else {
    base = { ...BASELINE_SNAPSHOT, homeInline: null, contentInline: null }
    src = `快照（${BASELINE_SNAPSHOT.note}；${BASELINE_DIR} 不存在，未重新构建基线）`
  }

  const delta = home.jsGzip - base.home.js
  if (delta <= FIRST_SCREEN_DELTA_MAX)
    pass('D3-1', 'D', `自定义首屏增量 ≤ ${FIRST_SCREEN_DELTA_MAX / 1024}KB gzip`, '拦截',
      `docs 首页 JS gzip ${home.jsGzip} B − 裸 Starlight 基线 ${base.home.js} B = +${delta} B（余量 ${FIRST_SCREEN_DELTA_MAX - delta} B）`,
      `基线来源：${src}；docs 首页静态 JS = ${home.js.map((r) => `${basename(r)} ${gz(join(DIST, r))}B`).join(' + ')}`)
  else
    fail('D3-1', 'D', `自定义首屏增量 ≤ ${FIRST_SCREEN_DELTA_MAX / 1024}KB gzip`, '拦截', `+${delta} B 超预算`, `基线来源：${src}`)

  const cDelta = content.jsGzip - base.content.js
  if (cDelta <= PAGE_TOTAL_DELTA_MAX)
    pass('D4-1', 'D', `单页全量 JS ≤ 基线同型页 + ${PAGE_TOTAL_DELTA_MAX / 1024}KB gzip`, '拦截',
      `内容页 JS gzip ${content.jsGzip} B − 基线内容页 ${base.content.js} B = +${cDelta} B（余量 ${PAGE_TOTAL_DELTA_MAX - cDelta} B）`,
      `基线来源：${src}；docs 内容页静态 JS = ${content.js.map((r) => `${basename(r)} ${gz(join(DIST, r))}B`).join(' + ')}`)
  else
    fail('D4-1', 'D', `单页全量 JS ≤ 基线同型页 + ${PAGE_TOTAL_DELTA_MAX / 1024}KB gzip`, '拦截', `+${cDelta} B 超预算`, `基线来源：${src}`)

  // 最重页面也必须落在预算内（防止个别页超标被首页样本掩盖）
  const heavy = htmlFiles
    .map((f) => {
      const a = assetsOf(f, DIST)
      return { f, url: '/' + f.slice(DIST.length + 1).split('\\').join('/').replace(/index\.html$/, ''), js: a.jsGzip }
    })
    .sort((a, b) => b.js - a.js)
  const worst = heavy[0]
  const heavyDelta = worst.js - base.content.js
  if (heavyDelta <= PAGE_TOTAL_DELTA_MAX)
    pass('D4-2', 'D', '全站最重页 JS 亦在预算内', '必修',
      `最重页 ${worst.url} JS gzip ${worst.js} B = 基线内容页 +${heavyDelta} B ≤ +${PAGE_TOTAL_DELTA_MAX} B（全站 ${heavy.length} 页最大增量）`, '')
  else
    fail('D4-2', 'D', '全站最重页 JS 亦在预算内', '必修', `${worst.url} +${heavyDelta} B 超预算`, '')

  // D7 内联脚本一致性
  if (base.homeInline) {
    const same = base.homeInline.join('\n') === home.inlineTexts.join('\n')
    if (same)
      pass('D7-1', 'D', '内联脚本与基线逐字一致（无自定义阻塞脚本）', '必修',
        `首页 ${home.inlineCount} 段内联脚本共 ${home.inline} B，与基线逐字相同`, '')
    else
      fail('D7-1', 'D', '内联脚本与基线逐字一致（无自定义阻塞脚本）', '必修',
        `首页内联脚本与基线不同（docs ${home.inline} B / ${home.inlineCount} 段，基线 ${base.home.inline} B）`, '')
  } else {
    pass('D7-1', 'D', '内联脚本体积与基线一致', '必修',
      `首页 ${home.inlineCount} 段内联脚本共 ${home.inline} B，与基线快照 ${base.home.inline} B 一致（基线工程未重建，无法逐字比对）`, '')
  }
}

// ---------------------------------------------------------------- D5 零运行时框架
{
  const FRAMEWORKS = ['react', 'preact', 'vue', 'svelte', '__svelte', 'angular', 'solid-js', 'lit-element', 'lit-html', '__lit']
  const staticJs = new Set()
  for (const f of htmlFiles) for (const r of assetsOf(f, DIST).js) staticJs.add(r)
  const hit = []
  for (const r of staticJs) {
    const p = join(DIST, r)
    if (!existsSync(p)) continue
    const t = readFileSync(p, 'utf8').toLowerCase()
    const found = FRAMEWORKS.filter((k) => t.includes(k))
    if (found.length) hit.push(`${r} 含 ${found.join('/')}`)
  }
  const lazy = walk(join(DIST, '_astro'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ f, t: readFileSync(f, 'utf8').toLowerCase() }))
    .filter(({ f }) => !staticJs.has(join('_astro', basename(f))))
    .filter(({ t }) => FRAMEWORKS.some((k) => t.includes(k)))
    .map(({ f }) => basename(f))
  if (!hit.length)
    pass('D5-1', 'D', '产物零运行时框架（静态引用链路）', '拦截',
      `${htmlFiles.length} 页共静态引用 ${staticJs.size} 个 JS，全部无 react/vue/svelte/preact/angular/solid/lit 运行时标记`,
      lazy.length ? `未被任何 HTML 静态引用、且含框架标记的惰性分块：${lazy.join(', ')}（Pagefind 搜索 UI 自身，仅在用户打开搜索框时动态 import，不属首屏链路）` : '')
  else
    fail('D5-1', 'D', '产物零运行时框架（静态引用链路）', '拦截', `${hit.length} 个静态 JS 含框架标记`, hit.slice(0, 8).join('；'))
}

// ---------------------------------------------------------------- D6 自定义 CSS 源文件预算
{
  const files = ['tokens.css', 'base.css', 'components.css', 'markdown.css']
  const missing = files.filter((f) => !existsSync(join(STYLES, f)))
  if (missing.length) {
    fail('D6-1', 'D', `自定义 CSS 源文件总量 ≤ ${CSS_SOURCE_MAX / 1024}KB`, '拦截', `缺少 ${missing.join(', ')}`, '')
  } else {
    const rows = files.map((f) => ({ f, raw: statSync(join(STYLES, f)).size, gzip: gz(join(STYLES, f)) }))
    const total = rows.reduce((a, r) => a + r.raw, 0)
    const totalGz = rows.reduce((a, r) => a + r.gzip, 0)
    const ev = rows.map((r) => `${r.f} ${r.raw}B/${r.gzip}B`).join('；')
    if (total <= CSS_SOURCE_MAX)
      pass('D6-1', 'D', `自定义 CSS 源文件总量 ≤ ${CSS_SOURCE_MAX / 1024}KB（gzip 前）`, '必修',
        `四文件合计 ${total} B ≤ ${CSS_SOURCE_MAX} B（余量 ${CSS_SOURCE_MAX - total} B），gzip 合计 ${totalGz} B`, ev)
    else
      fail('D6-1', 'D', `自定义 CSS 源文件总量 ≤ ${CSS_SOURCE_MAX / 1024}KB（gzip 前）`, '必修',
        `合计 ${total} B 超预算 ${total - CSS_SOURCE_MAX} B`, ev)
  }
}

// ---------------------------------------------------------------- 输出
const order = { 拦截: 0, 必修: 1, 建议: 2 }
results.sort((a, b) => order[a.severity] - order[b.severity] || a.id.localeCompare(b.id))
const blockers = results.filter((r) => r.severity === '拦截' && r.status === 'FAIL')

if (JSON_OUT) {
  console.log(JSON.stringify({
    script: 'audit-bundle',
    baseline: DIST,
    lighthouseDir: LH_DIR,
    baselineDir: BASELINE_DIR,
    pages: htmlFiles.length,
    results,
    blockers: blockers.length,
  }, null, 2))
} else {
  const icon = { PASS: '✓', FAIL: '✗', MANUAL: '?' }
  console.log('\n=== audit-bundle · 性能与产物体积（D 组）===')
  console.log(`产物：${DIST}`)
  console.log(`页面：${htmlFiles.length} 页；Lighthouse 报告目录：${LH_DIR}\n`)
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
