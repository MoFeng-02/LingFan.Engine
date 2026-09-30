// 构建后处理：加密发布形态的 dist 准备（`vite build` 之后、Tauri 嵌入之前）。
// - 直通模式（默认，LFEN_ENCRYPTED_BUILD≠1）：仅同步 splashscreen.html 进 dist
//   （splash 窗口由 Rust 桌面侧恒创建，明文/加密两形态都需要）。
// - 加密模式（LFEN_ENCRYPTED_BUILD=1）：改写 index.html 的产物引用为 LFStream 协议 URL
//   + 把 dist/assets 移出至 dist-enc/（lfenpack --dist 的输入）——frontendDist 内
//   绝不留明文 js/css（fail-closed 校验），入口 html 是唯一明文面。
//
// 纯函数（resolveProtocolBase / rewriteHtml）被 tests/playground/prepare-dist.test.ts 直接测试；
// 本文件主流程只做文件编排。
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * 平台 → lfstream 协议基座（与 Rust `protocol_base` 同口径：wry 行为，
 * Windows/Android 映射 http 虚拟 host，macOS/iOS/Linux 原生 scheme）。
 * TAURI_ENV_* 未注入 beforeBuildCommand（实测）：Android 构建下 undefined
 * → 默认 http 形态恰好正确；iOS 构建需显式传 LFEN_PROTOCOL_BASE（已知缺口，iOS 未通）。
 */
export function resolveProtocolBase(platform, env) {
  if (env.LFEN_PROTOCOL_BASE) return env.LFEN_PROTOCOL_BASE;
  return platform === "darwin" || platform === "linux"
    ? "lfstream://localhost"
    : "http://lfstream.localhost";
}

/**
 * 提取 html 里的本地产物引用（`/assets/...` 或 `./assets/...`）并改写为
 * `{base}/v2/dist%2F…`（encodeURIComponent 与 Rust 侧 utf8_percent_encode
 * 在 vite 产物名字符集 [A-Za-z0-9_.-] 上输出一致）。只改写构建产物内的
 * 相对引用（改写纪律：只碰构建产物内相对引用），动态拼接 URL 一概不碰。
 */
export function rewriteHtml(html, base) {
  const assets = [];
  const rewritten = html.replace(
    /(src|href)="(\.?\/assets\/[^"]+)"/g,
    (whole, attr, ref) => {
      const at = ref.indexOf("/assets/");
      const logical = `dist${ref.slice(at)}`;
      assets.push(logical);
      return `${attr}="${base}/v2/${encodeURIComponent(logical)}"`;
    },
  );
  return { html: rewritten, assets };
}

function fail(message) {
  console.error(`[prepare-dist] 失败：${message}`);
  process.exit(1);
}

function walkJsCss(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkJsCss(p, out);
    else if (/\.(js|mjs|css)$/.test(name)) out.push(p);
  }
  return out;
}

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const distEnc = join(root, "dist-enc");

// 主模块守卫：仅直接执行时跑文件编排（tests/playground/prepare-dist.test.ts import 纯函数，零副作用）
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}

function main() {
  if (!existsSync(dist)) fail("dist/ 不存在——先跑 vite build");

  // splash 恒同步（两形态都需要）
  cpSync(join(root, "splashscreen.html"), join(dist, "splashscreen.html"));

  if (process.env.LFEN_ENCRYPTED_BUILD !== "1") {
    console.log("[prepare-dist] 直通模式（LFEN_ENCRYPTED_BUILD≠1）：仅同步 splashscreen.html");
    process.exit(0);
  }

  const indexPath = join(dist, "index.html");
  if (!existsSync(indexPath)) fail("dist/index.html 不存在");
  const base = resolveProtocolBase(process.platform, process.env);
  const { html, assets } = rewriteHtml(readFileSync(indexPath, "utf8"), base);
  if (assets.length === 0) fail("index.html 无本地产物引用可改写——产物形态与预期不符（单包产物必须内联全部 chunk）");
  writeFileSync(indexPath, html);

  // assets 移出 frontendDist（明文 js/css 不得进 Tauri 嵌入面）；**保持 assets/ 子层**——
  // 改写 URL 的逻辑路径 = dist/assets/…，lfenpack --dist 收录路径必须与之逐一对应
  // （真窗冒烟实测逮住：rename 吃掉子层会让包内路径与协议 URL 错位 → 404）。
  rmSync(distEnc, { recursive: true, force: true });
  if (existsSync(join(dist, "assets"))) {
    mkdirSync(distEnc, { recursive: true });
    renameSync(join(dist, "assets"), join(distEnc, "assets"));
  } else fail("dist/assets 不存在——vite 产物形态与预期不符");

  // publicDir 拷贝清除（真窗冒烟实测逮住）：vite `publicDir: "Resources"` 会把明文资源
  // 整体镜像进 dist——加密形态下运行时资源走 lfenpack 产物，该镜像嵌入 exe = 泄密面。
  // dist 最终只允许剩入口 html + splash（明文例外全集）。
  for (const name of readdirSync(dist)) {
    if (name === "index.html" || name === "splashscreen.html") continue;
    rmSync(join(dist, name), { recursive: true, force: true });
  }

  const leftovers = walkJsCss(dist);
  if (leftovers.length > 0) fail(`frontendDist 内残留明文产物（拒绝嵌入）：\n  ${leftovers.join("\n  ")}`);

  console.log(
    `[prepare-dist] 加密准备完成：改写 ${assets.length} 个引用 → ${base}/v2/…；产物移至 dist-enc/（lfenpack --dist 输入）`,
  );
}
