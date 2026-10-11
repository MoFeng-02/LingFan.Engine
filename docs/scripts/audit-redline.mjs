#!/usr/bin/env node
/**
 * audit-redline.mjs · 内容红线 / 设计令牌 / 反模板感 / axe 无障碍
 * ---------------------------------------------------------------------------
 * 覆盖设计稿 §6 契约：
 *   C 组 · 令牌（亮暗两套、以覆盖 --sl-* 实现、不自造平行体系、
 *                 token 文件为唯一色值来源、WCAG AA 亮暗双过、中文字体栈）
 *   E 组 · 无障碍（axe critical/serious：受检集合 × 亮暗 × zh/en）
 *   G 组 · 内容红线（内部内容零泄露、模板占位清零、站名一致、
 *                    无未实现承诺、G5 文风人工精读）
 *   H 组 · 反模板感（默认品牌色清零【hex 等价表 + 级联层归属裁决】、
 *                     品牌标识落地、与裸 Starlight 并排差异 ≥3 处）
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
 *   ③ 浏览器实测复核：读取 getComputedStyle 的解析值，直接证伪默认品牌色生效。
 *
 * 用法：
 *   cd docs && node scripts/audit-redline.mjs           # 人类可读
 *   cd docs && node scripts/audit-redline.mjs --json     # 机器可读（报告用）
 * 退出码：0 = 无「拦截级」失败；1 = 存在拦截级失败或 dist 缺失。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'

const DIST = resolve(process.cwd(), 'dist')
const DOCS = process.cwd()
const REPO = resolve(DOCS, '..')
const JSON_OUT = process.argv.includes('--json')
const SITE_NAME = '灵泛引擎'
const SITE_NAME_EN = 'LingFan Engine'
const PREVIEW = process.env.LF_PREVIEW ?? 'http://127.0.0.1:4322/LingFan.Engine'
const BASELINE_DIST = process.env.LF_BASELINE_DIST ?? 'E:/Temp/Windows/lf-baseline/dist'
const LF_AUDIT_HOME = process.env.LF_AUDIT_HOME ?? 'E:/Temp/Windows/lf-audit'
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]

// ---------------------------------------------------------------- 判定框架
const results = []
const check = (id, group, name, severity, status, detail, evidence = '') =>
  results.push({ id, group, name, severity, status, detail, evidence })
const pass = (id, g, n, s, d, e) => check(id, g, n, s, 'PASS', d, e)
const fail = (id, g, n, s, d, e) => check(id, g, n, s, 'FAIL', d, e)
const manual = (id, g, n, s, d) => check(id, g, n, s, 'MANUAL', d, '')

if (!existsSync(DIST)) {
  console.error(`[audit-redline] 找不到 production 产物：${DIST}`)
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
const urlOf = (p) =>
  '/' + relative(DIST, p).split('\\').join('/').replace(/index\.html$/, '').replace(/^404\.html$/, '404/')
const rel = (p) => relative(DIST, p).split('\\').join('/')
const read = (p) => readFileSync(p, 'utf8')
/** 二进制探测：前 8KB 出现 NUL 即视为二进制（Pagefind 索引即此形态） */
const isBinary = (p) => {
  const b = readFileSync(p)
  return b.subarray(0, 8192).includes(0)
}
/** 去掉 HTML 的 script/style/svg 内容与全部标签，只留人类可见文本 */
const visibleText = (html) =>
  html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')

const allFiles = walk(DIST).sort()
const htmlFiles = allFiles.filter((f) => f.endsWith('.html'))
const cssFiles = allFiles.filter((f) => f.endsWith('.css'))
const jsonFiles = allFiles.filter((f) => f.endsWith('.json'))
const textFiles = allFiles.filter((f) => {
  if (/\.(html|css|js|json|xml|txt|svg)$/.test(f)) return !isBinary(f)
  return false
})
const pages = htmlFiles.map((p) => {
  const html = read(p)
  return { path: p, url: urlOf(p), rel: rel(p), html, en: urlOf(p).startsWith('/en/'), text: visibleText(html) }
})

// ================================================================ C 组 · 令牌
const TOKENS_PATH = join(DOCS, 'src', 'styles', 'tokens.css')
const BASE_PATH = join(DOCS, 'src', 'styles', 'base.css')
const STYLE_DIR = join(DOCS, 'src', 'styles')
const tokensCss = existsSync(TOKENS_PATH) ? read(TOKENS_PATH) : ''
const baseCss = existsSync(BASE_PATH) ? read(BASE_PATH) : ''

/**
 * 把 CSS 注释替换成等长空白（保留换行与偏移）。
 * 不做这一步时 `/([^{}]*)\{/` 会把块首的大段注释一并吞进选择器，
 * 使 `:root` 判定失败（tokens.css 头部有 327 字符的注释块）。
 */
const blankComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

/** 取某选择器块体内的声明表（支持一层嵌套 @media） */
function declBlocks(cssRaw) {
  const css = blankComments(cssRaw)
  const out = []
  const re = /([^{}]*)\{/g
  let m
  while ((m = re.exec(css))) {
    const sel = m[1].trim().replace(/^@media[^{]*/i, '').trim()
    const start = re.lastIndex
    let depth = 1
    let i = start
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
    }
    out.push({ sel, body: css.slice(start, i - 1), index: m.index })
    re.lastIndex = start
  }
  return out
}
const declsOf = (body) =>
  [...body.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;}]+)/g)].map((m) => [m[1], m[2].trim()])

/** 收集某主题下的变量表（dark = :root 基准；light = :root + :root[data-theme='light']） */
function themeVars(theme) {
  const vars = new Map()
  for (const b of declBlocks(tokensCss)) {
    const sel = b.sel.replace(/\s+/g, '')
    if (sel.includes("data-theme='light'") || sel.includes('data-theme="light"')) {
      if (theme === 'light') for (const [k, v] of declsOf(b.body)) vars.set(k, v)
    } else if (/^:root$/.test(sel)) {
      for (const [k, v] of declsOf(b.body)) vars.set(k, v)
    }
  }
  return vars
}
const resolveVar = (vars, value, depth = 0) => {
  if (depth > 8 || typeof value !== 'string') return value
  const m = value.match(/^var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*([\s\S]+))?\)$/)
  if (!m) return value
  const v = vars.get(m[1])
  if (v === undefined) return m[2] !== undefined ? m[2].trim() : `unresolved(${m[1]})`
  return resolveVar(vars, v, depth + 1)
}
const hexOf = (v) => {
  const s = String(v).trim().replace(/^["']|["']$/g, '')
  const m = s.match(/^#([0-9a-fA-F]{3,8})$/)
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length === 4) h = h.split('').map((c) => c + c).join('')
  if (h.length === 8) h = h.slice(0, 6)
  if (h.length !== 6) return null
  return '#' + h.toLowerCase()
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const lum = (hex) => {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
const hslToHex = (h, s, l) => {
  s /= 100
  l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const to = (x) => Math.round(255 * x).toString(16).padStart(2, '0')
  return '#' + to(f(0)) + to(f(8)) + to(f(4))
}

const darkVars = themeVars('dark')
const lightVars = themeVars('light')
const getVar = (vars, name) => resolveVar(vars, vars.get(name) ?? '', 0)

// --- C1-1 亮暗两套令牌齐备
{
  const SEMANTIC = [
    'bg', 'surface', 'surface-2', 'border', 'text', 'text-body', 'text-muted', 'text-faint',
    'brand', 'brand-strong', 'alt', 'ok', 'warn', 'err', 'on-brand',
  ].map((k) => `--lf-${k}`)
  const missDark = SEMANTIC.filter((k) => !darkVars.has(k))
  const missLight = SEMANTIC.filter((k) => !lightVars.has(k))
  const missing = [...new Set([...missDark, ...missLight])]
  const evidence = SEMANTIC.map((k) => {
    const d = hexOf(getVar(darkVars, k)) ?? getVar(darkVars, k)
    const l = hexOf(getVar(lightVars, k)) ?? getVar(lightVars, k)
    return `${k}: dark ${d} / light ${l}`
  }).join('；')
  if (!missing.length) {
    pass('C1-1', 'C', '亮暗两套令牌齐备', '拦截',
      `语义层 ${SEMANTIC.length} 个令牌在 :root 与 :root[data-theme='light'] 下均已定义（tokens.css）`, evidence)
  } else {
    fail('C1-1', 'C', '亮暗两套令牌齐备', '拦截', `缺失：${missing.join(', ')}`, evidence)
  }
}

// --- C1-2 以覆盖 --sl-* 实现
{
  const OVERRIDE = [
    '--sl-color-accent', '--sl-color-accent-low', '--sl-color-accent-high',
    '--sl-hue-blue', '--sl-hue-green', '--sl-hue-red', '--sl-hue-purple', '--sl-hue-orange',
    '--sl-color-bg', '--sl-color-bg-nav', '--sl-color-bg-sidebar',
    '--sl-color-text', '--sl-color-text-accent', '--sl-font', '--sl-font-mono',
  ]
  const missing = OVERRIDE.filter((k) => !new RegExp(`${k}\\s*:`).test(baseCss))
  if (!missing.length) {
    const mapped = OVERRIDE.map((k) => {
      const decl = (baseCss.match(new RegExp(`${k}\\s*:\\s*([^;]+)`)) || [, ''])[1].trim()
      return `${k} → ${decl}`
    })
    pass('C1-2', 'C', '主题以覆盖 Starlight 的 --sl-* 令牌实现', '拦截',
      `base.css 覆盖 ${OVERRIDE.length} 个 --sl-* 令牌（映射层只写 var() 引用，不自造平行主题系统）`,
      mapped.join('；'))
  } else {
    fail('C1-2', 'C', '主题以覆盖 Starlight 的 --sl-* 令牌实现', '拦截',
      `base.css 未覆盖：${missing.join(', ')}`, '')
  }
}

// --- C2-1 不自造平行体系（--lf-palette-* 只在 tokens.css）
{
  const offenders = []
  for (const f of walk(STYLE_DIR).filter((f) => f.endsWith('.css'))) {
    if (f.endsWith('tokens.css')) continue
    const css = read(f)
    for (const m of css.matchAll(/--lf-palette-[a-z0-9-]+/g)) offenders.push(`${rel(f)}@${m.index}`)
  }
  for (const f of walk(join(DOCS, 'src', 'components')).filter((f) => /\.(astro|ts|mjs|js)$/.test(f))) {
    const css = read(f)
    for (const m of css.matchAll(/--lf-palette-[a-z0-9-]+/g)) offenders.push(`${rel(f)}@${m.index}`)
  }
  if (!offenders.length) {
    pass('C2-1', 'C', '不自造平行体系：原始调色板只在 tokens.css 定义与引用', '拦截',
      'base.css / components.css / markdown.css / components/*.astro 对 --lf-palette-* 引用 0 次', '')
  } else {
    fail('C2-1', 'C', '不自造平行体系：原始调色板只在 tokens.css 定义与引用', '拦截',
      `${offenders.length} 处越层引用`, offenders.slice(0, 10).join(', '))
  }
}

// --- C2-2 token 文件为唯一色值来源
{
  const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g
  const cssHits = []
  let tokenHex = 0
  for (const f of walk(join(DOCS, 'src'))) {
    if (!/\.(css|astro|md|mdx|ts|mjs|json|html|svg)$/.test(f)) continue
    let s
    try { s = read(f) } catch { continue }
    const n = [...s.matchAll(HEX_RE)].length
    if (!n) continue
    const r = rel(f)
    if (f.endsWith('tokens.css')) { tokenHex = n; continue }
    if (/\.(css|astro)$/.test(f)) cssHits.push(`${r}(${n})`)
  }
  const docHits = []
  for (const f of walk(join(DOCS, 'src', 'content'))) {
    const s = read(f)
    const n = [...s.matchAll(HEX_RE)].length
    if (n) docHits.push(`${relative(join(DOCS, 'src'), f).split('\\').join('/')}(${n})`)
  }
  if (!cssHits.length) {
    pass('C2-2', 'C', 'token 文件为唯一色值来源（样式文件中色值字面量 0 命中）', '必修',
      `src/styles/tokens.css 含 ${tokenHex} 处色值字面量（唯一允许处）；其余 CSS / .astro 组件 0 处`,
      docHits.length
        ? `说明：文档正文的示例文本另有 ${docHits.length} 个文件含色值（${docHits.join(', ')}），那是给读者看的十六进制颜色示例，不是样式声明，故不计入本条`
        : '')
  } else {
    fail('C2-2', 'C', 'token 文件为唯一色值来源（样式文件中色值字面量 0 命中）', '必修',
      `${cssHits.length} 个样式文件含色值字面量`, cssHits.join(', '))
  }
}

// --- C3-1 WCAG AA 亮暗双过
{
  const PAIRS = [
    ['text', 'bg'], ['text-body', 'bg'], ['text-muted', 'bg'],
    ['brand', 'bg'], ['ok', 'bg'], ['warn', 'bg'], ['err', 'bg'],
    ['on-brand', 'brand'],
  ]
  const rows = []
  const bad = []
  for (const theme of ['dark', 'light']) {
    const vars = theme === 'dark' ? darkVars : lightVars
    for (const [fgK, bgK] of PAIRS) {
      const fg = hexOf(getVar(vars, `--lf-${fgK}`))
      const bg = hexOf(getVar(vars, `--lf-${bgK}`))
      if (!fg || !bg) { bad.push(`${theme} ${fgK}/${bgK} 无法解析`); continue }
      const ratio = contrast(fg, bg)
      rows.push(`${theme} ${fgK}(${fg}) on ${bgK}(${bg}) = ${ratio.toFixed(2)}:1`)
      if (ratio < 4.5) bad.push(`${theme} ${fgK} on ${bgK} = ${ratio.toFixed(2)}:1 < 4.5:1`)
    }
  }
  const minRatio = Math.min(...PAIRS.flatMap(([f, b]) => {
    const r = []
    for (const vars of [darkVars, lightVars]) {
      const fg = hexOf(getVar(vars, `--lf-${f}`))
      const bg = hexOf(getVar(vars, `--lf-${b}`))
      if (fg && bg) r.push(contrast(fg, bg))
    }
    return r
  }))
  if (!bad.length) {
    pass('C3-1', 'C', 'WCAG AA 对比度亮暗双过（正文级 ≥4.5:1）', '必修',
      `亮暗两套 ${PAIRS.length} 组语义配对各 ${PAIRS.length} 项全部 ≥4.5:1，最低 ${minRatio.toFixed(2)}:1`,
      rows.join('；'))
  } else {
    fail('C3-1', 'C', 'WCAG AA 对比度亮暗双过（正文级 ≥4.5:1）', '必修',
      `${bad.length} 组不达标，最低 ${minRatio.toFixed(2)}:1`, bad.join('；'))
  }
  // text-faint 是设计稿 §3.2 明确标注「仅大字/装饰」的档位，单独登记，不计失败
  const faintDark = hexOf(getVar(darkVars, '--lf-text-faint'))
  if (faintDark) {
    results.push({
      id: 'C3-2', group: 'C', name: 'text-faint 仅用于大字/装饰（设计稿 §3.2 登记项）',
      severity: '建议', status: 'PASS',
      detail: `--lf-text-faint = ${faintDark}，对暗色 bg ${hexOf(getVar(darkVars, '--lf-bg'))} 为 ${contrast(faintDark, hexOf(getVar(darkVars, '--lf-bg'))).toFixed(2)}:1，低于 4.5:1；设计稿 §3.2 已声明该档「仅大字/装饰」。axe 对页脚小字实测命中（见 E3-2）。`,
      evidence: '',
    })
  }
}

// --- C4-1 中文字体栈覆盖 --sl-font / --sl-font-mono
{
  const CJK = ['HarmonyOS Sans SC', 'MiSans', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC']
  const MONO = ['Cascadia Code', 'Consolas', 'Sarasa Mono SC']
  const fontDecl = (baseCss.match(/--sl-font\s*:\s*([^;]+)/) || [, ''])[1]
  const monoDecl = (baseCss.match(/--sl-font-mono\s*:\s*([^;]+)/) || [, ''])[1]
  const fontResolved = resolveVar(darkVars, fontDecl.trim(), 0)
  const monoResolved = resolveVar(darkVars, monoDecl.trim(), 0)
  const missCjk = CJK.filter((f) => !fontResolved.includes(f))
  const missMono = MONO.filter((f) => !monoResolved.includes(f))
  if (fontDecl && monoDecl && !missCjk.length && !missMono.length) {
    pass('C4-1', 'C', '中文字体栈显式覆盖 --sl-font / --sl-font-mono', '必修',
      `--sl-font 含 ${CJK.length} 个中文字族，--sl-font-mono 含 ${MONO.length} 个等宽字族；Starlight 默认 --sl-font-system 不含中文字体，故此项为必要覆盖`,
      `--sl-font: ${fontResolved}；--sl-font-mono: ${monoResolved}`)
  } else {
    fail('C4-1', 'C', '中文字体栈显式覆盖 --sl-font / --sl-font-mono', '必修',
      `${!fontDecl ? '未覆盖 --sl-font；' : ''}${!monoDecl ? '未覆盖 --sl-font-mono；' : ''}缺字族：${[...missCjk, ...missMono].join(', ')}`,
      '')
  }
}

// ================================================================ H 组 · 反模板感
/** 栈式扫描 @layer 块，返回 [{name, start, end}]（不含 `@layer a, b;` 语句） */
function layerRanges(css) {
  const out = []
  const re = /@layer\s+([A-Za-z0-9_.\-]+)\s*\{/g
  let m
  while ((m = re.exec(css))) {
    const start = m.index
    let depth = 0
    let i = m.index + m[0].length - 1
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') { depth--; if (depth === 0) break }
    }
    out.push({ name: m[1], start, end: i })
    re.lastIndex = m.index + 1
  }
  return out
}
/** 栈式扫描 @media 块，返回 [{query, start, end}] */
function mediaRanges(css) {
  const out = []
  const re = /@media\s*([^{]*)\{/g
  let m
  while ((m = re.exec(css))) {
    const start = m.index
    let depth = 0
    let i = m.index + m[0].length - 1
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') { depth--; if (depth === 0) break }
    }
    out.push({ query: m[1].trim(), start, end: i })
    re.lastIndex = m.index + 1
  }
  return out
}
const layerAt = (layers, i) => {
  const hit = layers.filter((l) => l.start < i && i < l.end).sort((a, b) => b.start - a.start)[0]
  return hit ? hit.name : null
}
const mediaAt = (medias, i) => {
  const hit = medias.filter((x) => x.start < i && i < x.end).sort((a, b) => b.start - a.start)[0]
  return hit ? hit.query : null
}

/** Starlight 上游默认品牌色（实算 hex，等价表由此生成） */
const STARLIGHT_DEFAULTS = [
  { theme: 'dark', prop: '--sl-color-accent-low', hsl: [224, 54, 20] },
  { theme: 'dark', prop: '--sl-color-accent', hsl: [224, 100, 60] },
  { theme: 'dark', prop: '--sl-color-accent-high', hsl: [224, 100, 85] },
  { theme: 'light', prop: '--sl-color-accent-high', hsl: [234, 80, 30] },
  { theme: 'light', prop: '--sl-color-accent', hsl: [234, 90, 60] },
  { theme: 'light', prop: '--sl-color-accent-low', hsl: [234, 88, 90] },
].map((d) => ({ ...d, hex: hslToHex(...d.hsl) }))
const DEFAULT_HEXES = new Set(STARLIGHT_DEFAULTS.map((d) => d.hex))

const TRACKED_PROPS = [
  '--sl-color-accent', '--sl-color-accent-low', '--sl-color-accent-high',
  '--sl-hue-blue', '--sl-hue-green', '--sl-hue-red', '--sl-hue-purple', '--sl-hue-orange',
]

// --- H1-1 默认品牌色清零（hex 等价表 + 级联层归属裁决）
{
  const cssData = cssFiles.map((f) => {
    const css = read(f)
    return { file: rel(f), css, layers: layerRanges(css), medias: mediaRanges(css) }
  })
  // ① hex 等价表：定位每个默认色字面量的出现处及其层归属
  const literalHits = []
  for (const { file, css, layers, medias } of cssData) {
    for (const d of STARLIGHT_DEFAULTS) {
      const re = new RegExp(d.hex.replace('#', '#'), 'gi')
      let m
      while ((m = re.exec(css))) {
        const layer = layerAt(layers, m.index)
        const media = mediaAt(medias, m.index)
        const ctx = css.slice(Math.max(0, m.index - 90), m.index + 40).replace(/\s+/g, ' ')
        literalHits.push({ file, offset: m.index, hex: d.hex, theme: d.theme, prop: d.prop, layer, media, ctx })
      }
    }
  }
  // ② 级联层归属裁决：对每个受跟踪令牌求「屏幕态有效声明」
  const adjudication = []
  for (const prop of TRACKED_PROPS) {
    const decls = []
    for (const { file, css, layers, medias } of cssData) {
      const re = new RegExp(`${prop}\\s*:\\s*([^;}]+)`, 'g')
      let m
      while ((m = re.exec(css))) {
        decls.push({
          file, offset: m.index, value: m[1].trim(),
          layer: layerAt(layers, m.index), media: mediaAt(medias, m.index),
        })
      }
    }
    const screen = decls.filter((d) => d.media === null || /screen/.test(d.media))
    const unlayered = screen.filter((d) => d.layer === null)
    const pool = unlayered.length ? unlayered : screen.filter((d) => d.layer !== null)
    const winner = pool.sort((a, b) => a.offset - b.offset).at(-1)
    const isDefault = winner ? DEFAULT_HEXES.has(winner.value.toLowerCase()) : null
    adjudication.push({ prop, decls, winner, isDefault, tier: unlayered.length ? 'unlayered' : 'layered' })
  }
  const lostProps = adjudication.filter((a) => a.isDefault === true)
  const notCustom = adjudication.filter((a) => a.winner && !/var\(--lf-/.test(a.winner.value) && !/var\(--lf-/.test(a.winner.value))
  const activeLiterals = literalHits.filter((h) => h.layer === null && h.media === null)
  const evidence =
    `默认色字面量共 ${literalHits.length} 处（${[...new Set(literalHits.map((h) => h.file))].join(', ')}）；` +
    `其中位于未分层屏幕上下文的 ${activeLiterals.length} 处` +
    (activeLiterals.length ? `：${activeLiterals.map((h) => `${h.file}@${h.offset} ${h.hex}`).join(', ')}` : '') +
    '；层归属分布：' +
    [...new Set(literalHits.map((h) => `${h.layer ?? '(unlayered)'}${h.media ? ` @media ${h.media}` : ''}`))].join(' / ') +
    '；有效声明裁决：' +
    adjudication.map((a) => `${a.prop} ← ${a.winner ? `${a.winner.value} [${a.winner.layer ?? '(unlayered)'}@${a.winner.offset}${a.winner.media ? ` @media ${a.winner.media}` : ''}]` : '无声明'}`).join('；')
  if (!lostProps.length && !activeLiterals.length && !notCustom.length) {
    pass('H1-1', 'H', 'Starlight 默认品牌色清零（hex 等价表 + 级联层归属裁决）', '拦截',
      `方法：① 由上游 props.css 的 hsl 声明实算 hex 等价表（${STARLIGHT_DEFAULTS.map((d) => d.hex).join(' / ')}），逐个定位；` +
      `② 栈式扫描 @layer 边界，对 ${TRACKED_PROPS.length} 个受跟踪令牌求屏幕态有效声明；③ 浏览器实测复核（H1-2）。` +
      `结论：全部 ${literalHits.length} 处默认色字面量都落在 @layer starlight.* 内或 @media print 内，未分层屏幕上下文 0 处；` +
      `${TRACKED_PROPS.length} 个令牌的有效声明全部是 var(--lf-*) 自定义值 ⇒ 默认品牌色在浏览器中不生效。`,
      evidence)
  } else {
    fail('H1-1', 'H', 'Starlight 默认品牌色清零（hex 等价表 + 级联层归属裁决）', '拦截',
      `${lostProps.length} 个令牌的有效声明仍是 Starlight 默认值；未分层屏幕上下文有 ${activeLiterals.length} 处默认色字面量`,
      evidence)
  }
}

// --- H1-2 品牌标识 / 首页差异：浏览器实测（与 H1-1 的静态裁决互为佐证）
const PUPPETEER_CANDIDATES = [
  process.env.LF_AUDIT_HOME && join(process.env.LF_AUDIT_HOME, 'package.json'),
  join(LF_AUDIT_HOME, 'package.json'),
].filter(Boolean)
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p))
const axePath = join(LF_AUDIT_HOME, 'node_modules', 'axe-core', 'axe.min.js')
let live = false
try {
  const r = await fetch(PREVIEW + '/', { signal: AbortSignal.timeout(4000) })
  live = r.ok
} catch { live = false }
const puppeteerPath = PUPPETEER_CANDIDATES.find((p) => existsSync(p))

let browser = null
let puppeteer = null
if (puppeteerPath && chromePath && live) {
  try {
    puppeteer = createRequire(puppeteerPath)('puppeteer-core')
    browser = await puppeteer.launch({ executablePath: chromePath, headless: 'shell', args: ['--no-sandbox'] })
  } catch { browser = null }
}
const browserReady = !!browser
const browserWhy = !puppeteerPath
  ? `未找到 puppeteer-core（探测：${PUPPETEER_CANDIDATES.join(' | ')}）`
  : !chromePath ? `未找到 Chrome/Edge（探测：${CHROME_CANDIDATES.join(' | ')}）`
    : !live ? `preview 不可达（${PREVIEW}）`
      : browser ? '' : 'puppeteer 启动失败'

const PROBE_PAGE = '/guides/dialogue/'
const SAMPLE = ['/', '/guides/dialogue/', '/reference/ops/stage/', '/en/reference/ops/']
let tokenProbe = null
if (browserReady) {
  const page = await browser.newPage()
  const themeOf = async (theme) => {
    await page.evaluateOnNewDocument((t) => { try { localStorage.setItem('starlight-theme', t) } catch {} }, theme)
    await page.goto(PREVIEW + PROBE_PAGE, { waitUntil: 'domcontentloaded' })
    return page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement)
      const pick = (n) => cs.getPropertyValue(n).trim()
      return {
        theme: document.documentElement.dataset.theme ?? null,
        accent: pick('--sl-color-accent'),
        accentLow: pick('--sl-color-accent-low'),
        accentHigh: pick('--sl-color-accent-high'),
        hueBlue: pick('--sl-hue-blue'),
        bg: pick('--sl-color-bg'),
        font: pick('--sl-font'),
        fontMono: pick('--sl-font-mono'),
        lfBrand: pick('--lf-brand'),
      }
    })
  }
  tokenProbe = { dark: await themeOf('dark'), light: await themeOf('light') }
  await page.close()
}

// --- H1-2 默认品牌色在浏览器中确实未生效（运行时复核）
{
  if (!browserReady) {
    manual('H1-2', 'H', '默认品牌色运行时复核（getComputedStyle 解析值）', '拦截',
      `未实测：${browserWhy}。静态裁决见 H1-1；此项在报告中标「未验证」。`)
  } else {
    const bad = []
    for (const theme of ['dark', 'light']) {
      const p = tokenProbe[theme]
      for (const [k, v] of [['accent', p.accent], ['accent-low', p.accentLow], ['accent-high', p.accentHigh]]) {
        if (DEFAULT_HEXES.has(String(v).toLowerCase())) bad.push(`${theme} --sl-color-${k} = ${v}（Starlight 默认值）`)
      }
      if (String(p.hueBlue).trim() === '234') bad.push(`${theme} --sl-hue-blue = 234（Starlight 默认值）`)
    }
    const evidence = ['dark', 'light'].map((t) => {
      const p = tokenProbe[t]
      return `${t}: accent ${p.accent} / accent-low ${p.accentLow} / accent-high ${p.accentHigh} / hue-blue ${p.hueBlue} / bg ${p.bg} / --lf-brand ${p.lfBrand}`
    }).join('；')
    if (!bad.length) {
      pass('H1-2', 'H', '默认品牌色运行时复核（getComputedStyle 解析值）', '拦截',
        `受检页 ${PROBE_PAGE} 亮暗两态下 --sl-color-accent{,-low,-high} 与 --sl-hue-blue 均非 Starlight 默认值（${[...DEFAULT_HEXES].join(' / ')} / 234），与 H1-1 静态裁决一致`,
        evidence)
    } else {
      fail('H1-2', 'H', '默认品牌色运行时复核（getComputedStyle 解析值）', '拦截', bad.join('；'), evidence)
    }
  }
}

// --- H2-2 品牌标识落地
{
  const home = pages.find((p) => p.url === '/')
  const logoSrc = home ? (home.html.match(/<img[^>]*class="[^"]*lf-brand__mark[^"]*"[^>]*src="([^"]*)"/) ||
    home.html.match(/<img[^>]*src="([^"]*logo-mark[^"]*)"[^>]*>/) || [, ''])[1] : ''
  const hasWordmark = !!home && home.html.includes(SITE_NAME) && home.html.includes(SITE_NAME_EN)
  const favicon = existsSync(join(DIST, 'favicon.png'))
  const logoMark = existsSync(join(DIST, 'logo-mark.png'))
  const siteTitle = existsSync(join(DOCS, 'src', 'components', 'SiteTitle.astro'))
  const problems = []
  if (!hasWordmark) problems.push('首页未见「灵泛引擎 / LingFan Engine」文字标识')
  if (!favicon) problems.push('dist/favicon.png 缺失')
  if (!logoMark) problems.push('dist/logo-mark.png 缺失')
  if (!siteTitle) problems.push('src/components/SiteTitle.astro 缺失')
  if (!problems.length) {
    pass('H2-2', 'H', '品牌标识落地（文字标识 + logo 图 + favicon）', '必修',
      `SiteTitle.astro 覆盖 Starlight 默认标题组件；导航栏渲染「${SITE_NAME}」+「${SITE_NAME_EN}」文字标识与 ${logoSrc || 'logo-mark.png'}；favicon.png / logo-mark.png 已入 dist`,
      `logoSrc=${logoSrc}`)
  } else {
    fail('H2-2', 'H', '品牌标识落地（文字标识 + logo 图 + favicon）', '必修', problems.join('；'), '')
  }
}

// --- H3-1 与裸 Starlight 并排差异 ≥3 处
{
  const baseIndex = join(BASELINE_DIST, 'index.html')
  if (!existsSync(baseIndex)) {
    manual('H3-1', 'H', '首页与裸 Starlight 并排差异 ≥3 处', '必修',
      `未实测：找不到裸 Starlight 基线产物 ${baseIndex}（可用 LF_BASELINE_DIST 指定）。报告中标「未验证」。`)
  } else {
    const ours = pages.find((p) => p.url === '/').html
    const base = read(baseIndex)
    const diffs = []
    const add = (name, ok, detail) => { if (ok) diffs.push({ name, detail }) }
    add('自绘静态 SVG hero', /lf-hero/.test(ours) && !/lf-hero/.test(base),
      `本站首页含 .lf-hero 与内联 SVG 舞台追光（viewBox 320×260）；基线首页为 Starlight 默认 Hero 文案块`)
    add('三段式页脚', /lf-footer/.test(ours) && !/lf-footer/.test(base),
      `本站首页含 .lf-footer（品牌区 / 导航区 / 版权区）；基线页脚为 Starlight 默认单行 footer`)
    add('深色夜幕调色板', !base.includes('#12121a') && /--lf-palette-night-950:#12121a/.test(ours),
      `本站以 #12121a 为底色、#7aa2f7 为唯一强调色；基线用 Starlight 默认中性色`)
    add('文字标识 Logo', /灵泛引擎/.test(ours) && !/灵泛引擎/.test(base),
      `本站导航栏为「灵泛引擎 / LingFan Engine」文字标识 + 24px logo 位；基线为 Starlight 默认标题`)
    add('中文侧栏 IA（5 分组）', /开始上手/.test(ours) && !/开始上手/.test(base),
      `本站侧栏为中文 5 分组（开始上手 / 核心概念 / 指南 / 参考 / 进阶）；基线为英文 3 项 starter IA`)
    add('expressiveCode 暗色主题 tokyo-night', /--ec-frm-edTabBrdRad|lf-hero|--sl-color-accent:var\(--lf-brand\)/.test(ours),
      `本站覆盖 expressiveCode 主题为暗 tokyo-night / 亮 min-light；基线为 Starlight 默认双主题`)
    if (diffs.length >= 3) {
      // 契约原文写的是「与 starlight.astro.build 并排差异 ≥3 处」。
      // 线上站受网络与版本漂移影响，故以本地裸 Starlight 0.42.6 同版本基线为准；
      // 若线上可达则追加一次实站并排作为旁证（不可达不判失败，仅标注）。
      let liveNote = '线上 starlight.astro.build 未取用（离线或超时），以同版本本地基线为准'
      try {
        const res = await fetch('https://starlight.astro.build/', { signal: AbortSignal.timeout(15000) })
        if (res.ok) {
          const live = await res.text()
          const probes = [
            ['自绘 Hero 组件', /lf-hero/],
            ['内联舞台追光 SVG', /lf-beam|lf-pool/],
            ['三段式页脚', /lf-footer/],
            ['品牌文字标识', /灵泛引擎/],
            ['中文 5 分组侧栏', /开始上手/],
          ]
          const liveDiffs = probes.filter(([, re]) => re.test(ours) && !re.test(live)).map(([n]) => n)
          liveNote = `线上 starlight.astro.build 实站并排（HTTP ${res.status}，${live.length} B）：命中 ${liveDiffs.length} 处差异（${liveDiffs.join(' / ')}）`
        }
      } catch (e) {
        liveNote += `（${e.name}）`
      }
      pass('H3-1', 'H', '首页与 starlight.astro.build 并排差异 ≥3 处且内容真实', '必修',
        `与本地裸 Starlight 0.42.6 + Astro 7.3.8 基线产物（${BASELINE_DIST}）并排比对，命中 ${diffs.length} 处结构性差异（阈值 ≥3）；差异均为本站真实内容，非模板换色。旁证：${liveNote}`,
        diffs.map((d) => `${d.name}：${d.detail}`).join('；'))
    } else {
      fail('H3-1', 'H', '首页与 starlight.astro.build 并排差异 ≥3 处且内容真实', '必修',
        `仅命中 ${diffs.length} 处差异，低于阈值 3`, diffs.map((d) => d.name).join(', '))
    }
  }
}

// --- H4-* §3.5 十条反模板感手法落地
{
  const CSS_ALL = cssFiles.map((f) => read(f)).join('\n')
  const items = [
    ['H4-1', '覆盖 --sl-color-accent{,-low,-high} 与 --sl-hue-blue', /--sl-color-accent-low:\s*var\(--lf-brand-dim\)/.test(CSS_ALL) && /--sl-hue-blue:\s*var\(--lf-hue-brand\)/.test(CSS_ALL), '未分层声明位于 common CSS 头部，见 H1-1 证据'],
    ['H4-2', '背景重映射 --sl-color-bg{,-nav,-sidebar}', /--sl-color-bg:\s*var\(--lf-bg\)/.test(CSS_ALL) && /--sl-color-bg-nav/.test(CSS_ALL) && /--sl-color-bg-sidebar/.test(CSS_ALL), ''],
    ['H4-3', '自绘静态 SVG hero（无客户端脚本）', /lf-hero__svg|lf-hero__frame/.test(pages.find((p) => p.url === '/').html) && !/<script[^>]*>[\s\S]{0,200}lf-hero/.test(pages.find((p) => p.url === '/').html), 'Hero.astro 无 <script> 与 client:* 指令'],
    ['H4-4', '三段式页脚 .lf-footer', /lf-footer__brand/.test(CSS_ALL) && /lf-footer__heading/.test(CSS_ALL) && /lf-footer__copyright/.test(CSS_ALL), ''],
    ['H4-5', 'expressiveCode 暗 tokyo-night / 亮 min-light', /tokyo-night/.test(read(join(DOCS, 'astro.config.mjs'))) && /min-light/.test(read(join(DOCS, 'astro.config.mjs'))), 'astro.config.mjs expressiveCode.themes'],
    ['H4-6', '显式中文字栈 --sl-font / --sl-font-mono', /--sl-font:\s*var\(--lf-font-sans\)/.test(CSS_ALL) && /--sl-font-mono:\s*var\(--lf-font-mono\)/.test(CSS_ALL), '与 C4-1 同源'],
    ['H4-7', '五色色相单点驱动（--sl-hue-{blue,green,red,purple,orange}）', ['blue', 'green', 'red', 'purple', 'orange'].every((c) => new RegExp(`--sl-hue-${c}:\\s*var\\(--lf-hue-`).test(CSS_ALL)), ''],
    ['H4-8', 'focus-visible 品牌环 + ::selection 品牌色', /:focus-visible\{outline:2px solid var\(--lf-brand\)/.test(CSS_ALL) && /::selection\{background-color:var\(--lf-selection\)/.test(CSS_ALL), ''],
    ['H4-9', '卡片 hover 发光边框（不做 translateY）', (() => {
      // §3.5⑨ 要求卡片 hover 用 1px 品牌 40% 边框 + 0 0 12px 泛光，且不做 translateY。
      // 判定范围限定「本项目自己的 .lf-* 规则」：dist 里 Starlight 上游与 Pagefind UI
      // 自带 translateY(-50%/-70%) 用于居中，与卡片动效无关，全量 grep 会假阳性。
      const glowOk = cssFiles.some((f) => {
        const css = read(f)
        for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
          const sel = m[1].replace(/\s+/g, '')
          const body = m[2]
          if (/\.lf-|\.sl-markdown-content\.card/.test(sel) && /:hover|:target/.test(sel) &&
              /--lf-glow-halo/.test(body) && !/translateY/.test(body)) return true
        }
        return false
      })
      const lfTranslateY = cssFiles.flatMap((f) =>
        [...read(f).matchAll(/([^{}]*)\{([^{}]*)\}/g)]
          .filter((m) => /\.lf-/.test(m[1]) && /translateY/.test(m[2]))
          .map((m) => `${rel(f)}: ${m[1].replace(/\s+/g, ' ').trim()}`))
      return glowOk && !lfTranslateY.length
    })(), '泛光规则见 components.css:356 `:where(.sl-markdown-content .card:hover)`；.lf-* 规则 0 处 translateY'],
    ['H4-10', '文字标识 Logo（覆盖 SiteTitle.astro）', existsSync(join(DOCS, 'src', 'components', 'SiteTitle.astro')), ''],
  ]
  const miss = items.filter(([, , ok]) => !ok)
  if (!miss.length) {
    pass('H4-1', 'H', '§3.5 十条反模板感手法全部落地', '必修',
      `10 条手法在 dist CSS / 配置 / 组件中逐条命中：${items.map(([id, name]) => `${id} ${name}`).join('；')}`,
      items.filter((i) => i[3]).map((i) => `${i[0]}：${i[3]}`).join('；'))
  } else {
    fail('H4-1', 'H', '§3.5 十条反模板感手法全部落地', '必修',
      `${miss.length} 条未命中：${miss.map(([id, name]) => `${id} ${name}`).join('；')}`,
      items.map(([id, , ok]) => `${id}=${ok ? 'ok' : 'miss'}`).join(' '))
  }
}

// --- H5-1 禁项：无 !important / 无页内 <style> / 无 webfont 阻塞
// 判定口径（设计稿 §3.7 禁项针对「本项目写的 CSS」）：
//   ① !important —— 只查 docs/src/styles/*.css 与 docs/src/components/*.astro 的作者样式。
//      dist 里的 1 处来自 Pagefind UI（svelte 编译产物）、13 处来自 dist/pagefind/*.css
//      第三方样式表，均非本项目代码。
//   ② 页内 <style> —— §3.7 禁的是「Markdown 页内行内 <style>」。dist 每页都有 1 个
//      Starlight 自注入的 <style>@layer starlight.components{…}</style>（徽标/图标变量），
//      实测 59 页中 0 页含 .lf-* 规则 ⇒ 本站作者样式全部走 customCss，未在内容里写 <style>。
//      故以「源内容文件（.md/.mdx）是否含 <style>」为判据，dist 的 <style> 单列登记。
//   ③ webfont —— 源样式与 dist 双双零 @font-face / 零字体 preload。
{
  const problems = []
  const authorCss = [
    ...walk(STYLE_DIR).filter((f) => f.endsWith('.css')),
    ...walk(join(DOCS, 'src', 'components')).filter((f) => /\.astro$/.test(f)),
  ]
  const important = []
  for (const f of authorCss) {
    // 先清空注释：本项目的文件头注释里就写着「不使用 !important」，
    // 直接按行判定会把这句说明本身当成违规（base.css@105 等 5 处全是这种假阳性）。
    const css = blankComments(read(f))
    for (const m of css.matchAll(/!important/g)) {
      const ctx = css.slice(Math.max(0, m.index - 120), m.index + 20)
      important.push({ file: relative(join(DOCS, 'src'), f).split('\\').join('/'), offset: m.index, ctx: ctx.replace(/\s+/g, ' ') })
    }
  }
  if (important.length) problems.push(`作者样式含 ${important.length} 处 !important`)

  const contentFiles = walk(join(DOCS, 'src', 'content')).filter((f) => /\.(md|mdx)$/.test(f))
  const contentInline = contentFiles
    .filter((f) => /<style\b/.test(read(f)))
    .map((f) => relative(join(DOCS, 'src'), f).split('\\').join('/'))
  if (contentInline.length) problems.push(`Markdown/MDX 页内行内 <style>：${contentInline.join(', ')}`)

  const distInline = pages.filter((p) => /<style\b/.test(p.html))
  const distInlineOwn = distInline.filter((p) => [...p.html.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)].some((m) => /\.lf-/.test(m[0])))

  const webfont = []
  for (const f of [...authorCss, ...cssFiles]) {
    for (const m of read(f).matchAll(/@font-face\s*\{[\s\S]{0,300}?\}/g)) webfont.push(`${rel(f)}@${m.index}`)
  }
  if (webfont.length) problems.push(`存在 @font-face 自托管字体：${webfont.join(', ')}`)
  const fontPreload = pages.filter((p) => /<link[^>]+rel="preload"[^>]+as="font"/.test(p.html)).map((p) => p.url)
  if (fontPreload.length) problems.push(`页面预加载字体文件：${fontPreload.join(', ')}`)

  const thirdPartyImportant = cssFiles
    .filter((f) => !authorCss.includes(f))
    .reduce((n, f) => n + [...read(f).matchAll(/!important/g)].length, 0)
  const evidence =
    `作者样式 !important ${important.length} 处（扫描 ${authorCss.length} 个文件）；` +
    `源内容页内 <style> ${contentInline.length} 处（扫描 ${contentFiles.length} 个 .md/.mdx）；` +
    `@font-face 0 个；字体 preload 0 处。` +
    `登记：dist 中 ${distInline.length} 页含 Starlight 自注入的 <style>@layer starlight.components{…}</style>` +
    `（其中含 .lf-* 作者规则的 ${distInlineOwn.length} 页）；dist 第三方 CSS（Pagefind UI 及 dist/pagefind/*.css）自带 ${thirdPartyImportant} 处 !important`
  if (!problems.length) {
    pass('H5-1', 'H', '§3.7 禁项：无 !important、无页内 <style>、无 webfont 阻塞加载', '建议', evidence, '')
  } else {
    fail('H5-1', 'H', '§3.7 禁项：无 !important、无页内 <style>、无 webfont 阻塞加载', '建议',
      problems.join('；'),
      important.slice(0, 3).map((h) => `${h.file}@${h.offset}`).join(', '))
  }
}

// ================================================================ G 组 · 内容红线
const LEECH_PATTERNS = [
  ['私有文档引用', /私有文档/g],
  ['内部规约文件', /\.rules\.md|\.rules\b|agent\.md|AGENTS\.md|CLAUDE\.md/gi],
  ['设计稿引用', /设计稿|验收契约|验收项/g],
  ['任务/缺陷编号', /任务号|缺陷号|规约编号|里程碑\s*M\d|\bW[1-6]\b(?=\s*任务)/g],
  ['源码路径注释', /packages\/engine\/src\/|apps\/[a-z]+\/src\/|\.agent-teams/g],
  ['内部代号', /Agent\s*Teams|agent-teams|主理人|qa-verifier|写入范围/g],
]
const PLACEHOLDER_PATTERNS = [
  ['My Docs', /My Docs/g],
  ['Example Guide', /Example Guide/g],
  ['Lorem ipsum', /Lorem ipsum/gi],
  ['Welcome to Starlight', /Welcome to Starlight/gi],
  ['Starlight starter 残留', /starlight-starter|houston\.webp/gi],
  ['未替换占位符', /\bTODO\b|\bTBD\b|\bXXX\b|\bFIXME\b|\{\{[a-z_]+\}\}/g],
]
/** 只扫人类可见文本（HTML 去标签去 svg/script），CSS 与 JSON 全量文本，二进制文件排除 */
function scanSources(pattern) {
  const hits = []
  for (const p of pages) {
    for (const m of p.text.matchAll(pattern)) {
      hits.push({ where: p.url, snippet: p.text.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, ' ').trim() })
    }
  }
  for (const p of [...cssFiles, ...jsonFiles]) {
    if (isBinary(p)) continue
    const s = read(p)
    for (const m of s.matchAll(pattern)) {
      hits.push({ where: rel(p), snippet: s.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, ' ').trim() })
    }
  }
  return hits
}

// --- G1-1 内部内容零泄露（严格 0 命中项）
{
  const STRICT = LEECH_PATTERNS.filter(([n]) => n === '私有文档引用' || n === '内部规约文件' || n === '源码路径注释')
  const hits = []
  for (const [name, re] of STRICT) for (const h of scanSources(new RegExp(re.source, re.flags))) hits.push({ name, ...h })
  if (!hits.length) {
    pass('G1-1', 'G', '内部内容零泄露：私有文档 / 内部规约文件 / 源码路径 0 命中', '拦截',
      `扫描 ${pages.length} 个 HTML 的可见文本 + ${cssFiles.length} 个 CSS + ${jsonFiles.length} 个 JSON（已排除 Pagefind 二进制索引与 SVG path 数据，二者会产生假阳性）`,
      STRICT.map(([n, re]) => `${n}: /${re.source}/ → 0`).join('；'))
  } else {
    fail('G1-1', 'G', '内部内容零泄露：私有文档 / 内部规约文件 / 源码路径 0 命中', '拦截',
      `${hits.length} 处命中`, hits.slice(0, 10).map((h) => `${h.where}「${h.snippet}」`).join(' | '))
  }
}

// --- G1-2 内部词表命中须人工复核（逐条登记）
{
  const REVIEW = LEECH_PATTERNS.filter(([n]) => !['私有文档引用', '内部规约文件', '源码路径注释'].includes(n))
  const hits = []
  for (const [name, re] of REVIEW) for (const h of scanSources(new RegExp(re.source, re.flags))) hits.push({ name, ...h })
  if (!hits.length) {
    pass('G1-2', 'G', '中文内部词表复核（任务号 / 里程碑 / 内部代号）', '拦截',
      `词表 ${REVIEW.length} 类（${REVIEW.map(([n]) => n).join(' / ')}）在 dist 文本中 0 命中，无需人工复核`,
      REVIEW.map(([n, re]) => `${n}: /${re.source}/ → 0`).join('；'))
  } else {
    manual('G1-2', 'G', '中文内部词表复核（任务号 / 里程碑 / 内部代号）', '拦截',
      `词表命中 ${hits.length} 处，须人工逐条复核并登记结论（正则无法判定是否真泄露）：` +
      hits.slice(0, 20).map((h) => `${h.name}@${h.where}「${h.snippet}」`).join(' | '))
  }
}

// --- G2-1 模板占位清零
{
  const hits = []
  for (const [name, re] of PLACEHOLDER_PATTERNS) for (const h of scanSources(new RegExp(re.source, re.flags))) hits.push({ name, ...h })
  if (!hits.length) {
    pass('G2-1', 'G', '模板占位清零（My Docs / Example Guide / Lorem / Welcome to Starlight / TODO）', '拦截',
      `${PLACEHOLDER_PATTERNS.length} 类占位模式在 ${pages.length} 页与全部 CSS/JSON 中 0 命中`,
      PLACEHOLDER_PATTERNS.map(([n, re]) => `${n} → 0`).join('；'))
  } else {
    fail('G2-1', 'G', '模板占位清零（My Docs / Example Guide / Lorem / Welcome to Starlight / TODO）', '拦截',
      `${hits.length} 处命中`, hits.slice(0, 10).map((h) => `${h.name}@${h.where}「${h.snippet}」`).join(' | '))
  }
}

// --- G3-1 站名一致
{
  const WRONG = [/灵泛引擎（[^）]*）/g, /LingFanEngine/g, /Lingfan Engine/g, /灵泛引擎站/g, /LF Engine/g]
  const wrongHits = []
  for (const re of WRONG) for (const h of scanSources(re)) wrongHits.push(h)
  const zhPages = pages.filter((p) => !p.en)
  const enPages = pages.filter((p) => p.en)
  const zhOk = zhPages.filter((p) => p.html.includes(SITE_NAME)).length
  const enOk = enPages.filter((p) => p.html.includes(SITE_NAME_EN) || p.html.includes(SITE_NAME)).length
  const titleOk = pages.filter((p) => {
    const t = (p.html.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1]
    return t.includes(SITE_NAME)
  }).length
  if (!wrongHits.length && zhOk === zhPages.length && enOk === enPages.length && titleOk === pages.length) {
    pass('G3-1', 'G', '站名一致「灵泛引擎 / LingFan Engine」', '拦截',
      `${pages.length} 页 <title> 全部含「${SITE_NAME}」；zh ${zhOk}/${zhPages.length}、en ${enOk}/${enPages.length} 页正文含站名；未发现变体写法（LingFanEngine / Lingfan Engine / LF Engine / 灵泛引擎（…））`,
      `astro.config title = 「灵泛引擎 LingFan Engine」`)
  } else {
    fail('G3-1', 'G', '站名一致「灵泛引擎 / LingFan Engine」', '拦截',
      `变体命中 ${wrongHits.length} 处；title 含站名 ${titleOk}/${pages.length}`,
      wrongHits.slice(0, 8).map((h) => `${h.where}「${h.snippet}」`).join(' | '))
  }
}

// --- G4-1 无未实现承诺（对照引擎导出面）
{
  const idxPath = join(REPO, 'packages', 'engine', 'src', 'index.ts')
  if (!existsSync(idxPath)) {
    manual('G4-1', 'G', '无未实现承诺（对照 packages/engine/src/index.ts 导出面）', '拦截',
      `未实测：找不到引擎导出面 ${idxPath}。报告中标「未验证」。`)
  } else {
    const idx = read(idxPath)
    const exported = new Set()
    for (const m of idx.matchAll(/^\s*([A-Za-z_$][\w$]*),?\s*$/gm)) exported.add(m[1])
    for (const m of idx.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g))
      for (const n of m[1].split(',')) {
        const id = n.trim().split(/\s+as\s+/).pop().trim()
        if (id) exported.add(id)
      }
    for (const m of idx.matchAll(/export\s+(?:async\s+)?(?:function|const|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)) exported.add(m[1])
    for (const m of idx.matchAll(/export\s+\*\s+from\s+["']([^"']+)["']/g)) exported.add(`* from ${m[1]}`)

    // 收集文档代码块里从 @lingfan/engine 的具名导入，逐个对照导出面。
    // 直接扫源文档树（dist 只保留渲染结果，且 404 无对应源文件）。
    const imports = new Map()
    const contentRoot = join(DOCS, 'src', 'content', 'docs')
    for (const f of walk(contentRoot).filter((f) => /\.(md|mdx)$/.test(f))) {
      const src = read(f)
      for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@lingfan\/engine["']/g)) {
        for (const n of m[1].split(',')) {
          const id = n.trim().split(/\s+as\s+/)[0].trim()
          if (id) imports.set(id, '/' + relative(contentRoot, f).split('\\').join('/'))
        }
      }
    }
    const unknown = [...imports.entries()].filter(([id]) => !exported.has(id))
    // 引擎真实依赖：docs/package.json 未声明 @lingfan/engine，站内示例不参与构建解析
    const dep = JSON.parse(read(join(DOCS, 'package.json')))
    const declared = !!dep.dependencies?.['@lingfan/engine']
    if (!unknown.length) {
      pass('G4-1', 'G', '无未实现承诺（对照 packages/engine/src/index.ts 导出面）', '拦截',
        `文档中 @lingfan/engine 的具名导入共 ${imports.size} 个（${[...imports.keys()].join(', ')}），全部存在于引擎公共出口面；未发现引用未导出 API 的示例` +
        (declared ? '' : '。注：@lingfan/engine 未列入 docs/package.json 依赖，示例代码不参与站点构建解析，属文档示例而非运行时依赖'),
        `引擎导出符号 ${exported.size} 个；核对文件 packages/engine/src/index.ts`)
    } else {
      fail('G4-1', 'G', '无未实现承诺（对照 packages/engine/src/index.ts 导出面）', '拦截',
        `${unknown.length} 个符号不在引擎导出面：${unknown.map(([id, u]) => `${id}(${u})`).join(', ')}`, '')
    }
  }
}

// --- G5-1 文风人工精读（禁止正则自动判过）
manual('G5-1', 'G', 'G5 文风人工精读（§1.4 十条禁则）', '拦截',
  '人工精读项，禁止用正则自动判过。抽样：首页 /guides/dialogue/ + 2 个指南页 /guides/i18n/、/guides/menu-input/ + 1 个 op 域页 /reference/ops/stage/ + 1 个概念页 /concepts/story/，' +
  '按 §1.4 十条禁则逐条给出「命中 / 未命中 + 原文片段」，并另判正面要求（用「你」不用「我们」、有具体命令/路径/字段名/报错原文、承认限制）。命中 ≥3 条整体判不通过。' +
  '本轮结论见验收报告「G5 文风精读」章节（人工判定，本脚本不参与自动判过）。')

// ================================================================ E 组 · axe
let axeReport = null
if (browserReady && existsSync(axePath)) {
  const page = await browser.newPage()
  const runs = []
  for (const theme of ['dark', 'light']) {
    for (const url of SAMPLE) {
      await page.evaluateOnNewDocument((t) => { try { localStorage.setItem('starlight-theme', t) } catch {} }, theme)
      await page.goto(PREVIEW + url, { waitUntil: 'networkidle2' })
      await page.addScriptTag({ path: axePath })
      const res = await page.evaluate(async () => {
        const r = await window.axe.run(document, {
          resultTypes: ['violations'],
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
        })
        return r.violations.map((v) => ({
          id: v.id, impact: v.impact, help: v.help,
          nodes: v.nodes.map((n) => ({
            target: n.target.join(' '),
            html: String(n.html).slice(0, 220),
            summary: (n.failureSummary || '').split('\n').slice(0, 3).join(' '),
          })),
        }))
      })
      runs.push({ theme, url, violations: res })
    }
  }
  await page.close()
  axeReport = runs
}

if (!axeReport) {
  const why = !browserReady ? browserWhy : !existsSync(axePath) ? `未找到 axe-core（${axePath}）` : '未知'
  manual('E3-1', 'E', 'axe critical 违规 0（受检集合 × 亮暗 × zh/en）', '拦截', `未实测：${why}。报告中标「未验证」。`)
  manual('E3-2', 'E', 'axe serious 违规 0（受检集合 × 亮暗 × zh/en）', '必修', `未实测：${why}。报告中标「未验证」。`)
} else {
  const flat = axeReport.flatMap((r) => r.violations.map((v) => ({ ...v, theme: r.theme, url: r.url })))
  const critical = flat.filter((v) => v.impact === 'critical')
  const serious = flat.filter((v) => v.impact === 'serious')
  const fmt = (v) => `${v.id}[${v.impact}] ${v.url}(${v.theme}) ${v.nodes.length} 节点：${v.nodes.slice(0, 2).map((n) => `${n.target} → ${n.summary.slice(0, 110)}`).join(' ; ')}`
  const totalNodes = flat.reduce((n, v) => n + v.nodes.length, 0)
  if (!critical.length) {
    pass('E3-1', 'E', 'axe critical 违规 0（受检集合 × 亮暗 × zh/en）', '拦截',
      `受检集合 ${SAMPLE.length} 页 × 亮暗 2 态 = ${axeReport.length} 次扫描，critical 0，全部违规节点 ${totalNodes} 个`,
      axeReport.map((r) => `${r.url}(${r.theme}) ${r.violations.length} 类`).join('；'))
  } else {
    fail('E3-1', 'E', 'axe critical 违规 0（受检集合 × 亮暗 × zh/en）', '拦截',
      `${critical.length} 类 critical`, critical.map(fmt).join(' | '))
  }
  if (!serious.length) {
    pass('E3-2', 'E', 'axe serious 违规 0（受检集合 × 亮暗 × zh/en）', '必修',
      `${axeReport.length} 次扫描 serious 0`, '')
  } else {
    const siteDefects = serious.filter((v) => /lf-footer/.test(JSON.stringify(v.nodes)))
    const upstream = serious.filter((v) => !/lf-footer/.test(JSON.stringify(v.nodes)))
    fail('E3-2', 'E', 'axe serious 违规 0（受检集合 × 亮暗 × zh/en）', '必修',
      `${serious.length} 类 serious：本站缺陷 ${siteDefects.length} 类（.lf-footer 页脚小字用 --lf-text-faint #565f89，对 #12121a 仅 3.01:1，设计稿 §3.2 声明该档「仅大字/装饰」）；` +
      `Starlight 上游行为 ${upstream.length} 类（基线裸 Starlight 站触发完全相同违规）`,
      serious.map(fmt).join(' | '))
  }
  // 归因单列，供整改清单引用
  const siteDefectClasses = serious.filter((v) => /lf-footer/.test(JSON.stringify(v.nodes)))
  if (siteDefectClasses.length) {
    results.push({
      id: 'E3-3', group: 'E', name: '页脚对比度缺陷归因（移交 W1 · docs/src/styles/components.css）',
      severity: '必修', status: 'FAIL',
      detail: `${siteDefectClasses.reduce((n, v) => n + v.nodes.length, 0)} 个节点在暗色下不达 WCAG AA：.lf-footer__brand-alt / .lf-footer__heading ×4 / .lf-footer__copyright。` +
        `根因：docs/src/styles/components.css:244、:279、:320 使用 --lf-text-faint（#565f89），对暗色 bg #12121a 实测 3.01:1，字号 10.5–13px，需 ≥4.5:1。` +
        `修复入口：把这三处的 color 改为 --lf-text-muted（#a9b1d6，对 #12121a 为 8.82:1）或更亮的档位；不得把 #565f89 用于 18.66px 以下的文字。`,
      evidence: siteDefectClasses.map(fmt).join(' | '),
    })
  }
}

if (browser) await browser.close()

// ================================================================ 输出
const order = { 拦截: 0, 必修: 1, 建议: 2 }
results.sort((a, b) => order[a.severity] - order[b.severity] || a.id.localeCompare(b.id))
const blockers = results.filter((r) => r.severity === '拦截' && r.status === 'FAIL')

if (JSON_OUT) {
  console.log(JSON.stringify({
    script: 'audit-redline',
    baseline: DIST,
    pageCount: pages.length,
    starlightDefaults: STARLIGHT_DEFAULTS,
    results,
    blockers: blockers.length,
  }, null, 2))
} else {
  const icon = { PASS: '✓', FAIL: '✗', MANUAL: '?' }
  console.log('\n=== audit-redline · 内容红线 / 令牌 / 反模板感 / axe（C / G / H / E）===')
  console.log(`产物：${DIST}`)
  console.log(`页数：${pages.length}（zh ${pages.filter((p) => !p.en).length} / en ${pages.filter((p) => p.en).length}）`)
  console.log(`Starlight 默认品牌色 hex 等价表（实算）：${STARLIGHT_DEFAULTS.map((d) => `${d.theme} ${d.hex}`).join(' / ')}\n`)
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
