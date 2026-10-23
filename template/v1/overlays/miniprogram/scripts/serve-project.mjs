#!/usr/bin/env node
/**
 * 本地开发服务：把工程根下的 `Resources/` 按小程序宿主的取法提供出去（仅开发用）。
 *
 * 两条路由，对应宿主的两类请求：
 * - `GET /project` → `{ manifest, stories }`：清单 + 全部故事原文合成一次响应
 *   （故事原文不解析，解析归引擎的组装器——与线上接口的约定一致）；
 * - `GET /<资源 id>` → 资源文件本体（`Audio/x.mp3`、`Video/x.mp4`…），支持 Range
 *   （视频拖动、在线播放都要它）。
 *
 * 内容根缺省指工程的资源根 `Resources/`：与骨架 `vite.config.ts` 的 `publicDir` 同一处，
 * 一个工程只有一份内容，开发服务与浏览器形态读的是同一批文件。
 *
 * 生产形态不需要这个脚本：同一套取法由静态托管 + 后端接口承担，宿主只换基址。
 *
 * 用法：`node scripts/serve-project.mjs [--port 5273] [--host 127.0.0.1] [--root <目录>]`
 */
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** 内容根（缺省 = 工程根下的 `Resources/`） */
const DEFAULT_ROOT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "Resources",
);
/** 缺省端口：与宿主 `project-source.ts` 的缺省基址一致 */
const DEFAULT_PORT = 5273;
/** 缺省只绑回环：开发服务不对外 */
const DEFAULT_HOST = "127.0.0.1";
/** 故事目录（相对内容根） */
const STORIES_DIR = "Stories";
/** 扩展名 → Content-Type */
const MIME_TYPES = new Map([
  [".json", "application/json; charset=utf-8"],
  [".story", "text/plain; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".m4a", "audio/mp4"],
  [".ogg", "audio/ogg"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"],
  [".woff2", "font/woff2"],
]);

const options = parseArgs(process.argv.slice(2));
const root = resolve(options.root ?? DEFAULT_ROOT);

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error(
      `[serve-project] ${request.method} ${request.url} 失败：${error}`,
    );
    sendJson(response, 500, { error: "服务内部错误" });
  });
});

server.listen(
  options.port ?? DEFAULT_PORT,
  options.host ?? DEFAULT_HOST,
  () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : "?";
    console.log(
      `[serve-project] 已启动：http://${options.host ?? DEFAULT_HOST}:${port}/`,
    );
    console.log(`[serve-project] 内容根：${root}`);
    console.log(`[serve-project] 工程接口：http://127.0.0.1:${port}/project`);
  },
);

/**
 * 路由：`/project` 是工程接口，其余按静态资源处理。
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
async function handle(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "只支持 GET/HEAD" });
    return;
  }
  const pathname = decodeURIComponent(
    new URL(request.url ?? "/", "http://127.0.0.1").pathname,
  );
  if (pathname === "/project") {
    await sendProject(response);
    return;
  }
  await sendFile(response, pathname, request.headers.range);
}

/** 工程接口：清单与全部故事原文 */
async function sendProject(response) {
  const manifestText = await readFile(join(root, "project.json"), "utf8");
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new Error("project.json 不是合法 JSON");
  }
  const stories = await readStories(root);
  sendJson(response, 200, { manifest, stories });
}

/**
 * 递归收齐故事文件：逻辑路径（`Stories/…`）→ 原始文本。
 * @param {string} directory 内容根
 * @returns {Promise<Record<string, string>>}
 */
async function readStories(directory) {
  const storiesRoot = join(directory, STORIES_DIR);
  const files = await walk(storiesRoot);
  const stories = {};
  for (const file of files) {
    const relative = file
      .slice(directory.length + 1)
      .split(sep)
      .join("/");
    stories[relative] = await readFile(file, "utf8");
  }
  return stories;
}

/**
 * 递归列文件（只收 .json 与 .story：故事文件的两种形态）。
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (
      extname(entry.name) === ".json" ||
      extname(entry.name) === ".story"
    )
      files.push(path);
  }
  return files.sort();
}

/**
 * 静态资源：路径必须落在内容根之内（拒绝 `..` 与绝对路径逃逸），带 Range 支持。
 * @param {import("node:http").ServerResponse} response
 * @param {string} pathname 请求路径（已解码）
 * @param {string | undefined} rangeHeader
 */
async function sendFile(response, pathname, rangeHeader) {
  const target = resolve(join(root, pathname));
  if (target !== root && !target.startsWith(root + sep)) {
    sendJson(response, 400, { error: "路径越出内容根" });
    return;
  }
  let info;
  try {
    info = await stat(target);
  } catch {
    sendJson(response, 404, { error: `没有这个资源：${pathname}` });
    return;
  }
  if (!info.isFile()) {
    sendJson(response, 404, { error: `不是文件：${pathname}` });
    return;
  }
  const type =
    MIME_TYPES.get(extname(target).toLowerCase()) ?? "application/octet-stream";
  const headers = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  };
  const range = parseRange(rangeHeader, info.size);
  if (range === "invalid") {
    headers["Content-Range"] = `bytes */${info.size}`;
    sendJson(response, 416, { error: "Range 不合法" }, headers);
    return;
  }
  if (range === null) {
    headers["Content-Length"] = String(info.size);
    response.writeHead(200, headers);
    createReadStream(target).pipe(response);
    return;
  }
  headers["Content-Range"] = `bytes ${range.start}-${range.end}/${info.size}`;
  headers["Content-Length"] = String(range.end - range.start + 1);
  response.writeHead(206, headers);
  createReadStream(target, { start: range.start, end: range.end }).pipe(
    response,
  );
}

/**
 * 解析 `Range: bytes=a-b`：返回闭区间、`null`（无 Range）或 `"invalid"`。
 * @param {string | undefined} header
 * @param {number} size
 * @returns {{ start: number; end: number } | null | "invalid"}
 */
function parseRange(header, size) {
  if (typeof header !== "string" || !header.startsWith("bytes=")) return null;
  const spec = header.slice("bytes=".length).split(",")[0].trim();
  const dash = spec.indexOf("-");
  if (dash < 0) return "invalid";
  const startText = spec.slice(0, dash).trim();
  const endText = spec.slice(dash + 1).trim();
  let start;
  let end;
  if (startText === "") {
    // `bytes=-N`：最后 N 字节
    const tail = Number(endText);
    if (!Number.isFinite(tail) || tail <= 0) return "invalid";
    start = Math.max(0, size - tail);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText === "" ? size - 1 : Number(endText);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "invalid";
  if (start < 0 || end < start || start >= size) return "invalid";
  return { start, end: Math.min(end, size - 1) };
}

/**
 * 回一份 JSON。
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 * @param {import("node:http").OutgoingHttpHeaders} [extra]
 */
function sendJson(response, status, body, extra = {}) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    ...extra,
  });
  response.end(text);
}

/**
 * 命令行参数：`--port` / `--host` / `--root`，也认 `--key=value` 形态。
 * @param {string[]} argv
 * @returns {{ port?: number; host?: string; root?: string }}
 */
function parseArgs(argv) {
  /** @type {{ port?: number; host?: string; root?: string }} */
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const paired = arg.startsWith("--") && arg.includes("=");
    const key = paired ? arg.slice(2, arg.indexOf("=")) : arg.slice(2);
    const value = paired ? arg.slice(arg.indexOf("=") + 1) : argv[index + 1];
    if (!paired) index += 1;
    if (value === undefined) throw new Error(`参数缺少取值：${arg}`);
    if (key === "port") out.port = Number(value);
    else if (key === "host") out.host = value;
    else if (key === "root") out.root = value;
    else throw new Error(`未知参数：${arg}`);
  }
  return out;
}
