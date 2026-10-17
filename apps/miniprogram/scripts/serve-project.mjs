#!/usr/bin/env node
/**
 * 本地开发服务：把 `apps/miniprogram/project/` 按小程序宿主的取法提供出去（仅开发用）。
 *
 * 两条路由，对应宿主的两类请求：
 * - `GET /project` → `{ manifest, stories }`：清单 + 全部故事原文合成一次响应
 *   （故事原文不解析，解析归引擎的组装器——与线上接口的约定一致）；
 * - `GET /<资源 id>` → 资源文件本体（`Audio/x.mp3`、`Video/x.mp4`…），支持 Range
 *   （视频拖动、在线播放都要它）。
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

/** 工程根（缺省 = 本包下的 project/） */
const DEFAULT_ROOT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "project",
);
/** 缺省端口：与宿主 `project-source.ts` 的缺省基址一致 */
const DEFAULT_PORT = 5273;
/** 缺省只绑回环：开发服务不对外 */
const DEFAULT_HOST = "127.0.0.1";
/** 故事目录（相对工程根） */
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

server.listen(options.port, options.host, () => {
  console.log(
    `[serve-project] http://${options.host}:${options.port}/  → ${root}`,
  );
  console.log(
    `[serve-project] 工程接口 http://${options.host}:${options.port}/project`,
  );
});

/**
 * 处理一次请求：`/project` 走工程接口，其余按静态资源取。
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
async function handle(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "只支持 GET / HEAD" });
    return;
  }
  const url = new URL(request.url ?? "/", "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
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
 * @param {string} directory 工程根
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
 * 静态资源：路径必须落在工程根之内（拒绝 `..` 与绝对路径逃逸），带 Range 支持。
 * @param {import("node:http").ServerResponse} response
 * @param {string} pathname 请求路径（已解码）
 * @param {string | undefined} rangeHeader
 */
async function sendFile(response, pathname, rangeHeader) {
  const target = resolve(join(root, pathname));
  if (target !== root && !target.startsWith(root + sep)) {
    sendJson(response, 400, { error: "路径越出工程根" });
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
    response.writeHead(416, {
      ...headers,
      "Content-Range": `bytes */${info.size}`,
    });
    response.end();
    return;
  }
  if (range !== null) {
    const { start, end } = range;
    response.writeHead(206, {
      ...headers,
      "Content-Range": `bytes ${start}-${end}/${info.size}`,
      "Content-Length": String(end - start + 1),
    });
    createReadStream(target, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, { ...headers, "Content-Length": String(info.size) });
  createReadStream(target).pipe(response);
}

/**
 * 解析 `Range: bytes=start-end`；不合法返回 "invalid"，没给返回 null。
 * @param {string | undefined} header
 * @param {number} size
 * @returns {{ start: number; end: number } | "invalid" | null}
 */
function parseRange(header, size) {
  if (header === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) return "invalid";
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return "invalid";
  let start;
  let end;
  if (rawStart === "") {
    end = size - 1;
    start = Math.max(0, size - Number(rawEnd));
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "invalid";
  if (start > end || start < 0 || end >= size) return "invalid";
  return { start, end };
}

/**
 * 回一个 JSON 响应。
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(text)),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  response.end(text);
}

/**
 * 解析命令行参数。
 * @param {string[]} argv
 * @returns {{ port: number; host: string; root: string | undefined }}
 */
function parseArgs(argv) {
  const parsed = { port: DEFAULT_PORT, host: DEFAULT_HOST, root: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`缺少参数值：${flag}`);
    if (flag === "--port") {
      parsed.port = Number(value);
      index += 1;
    } else if (flag === "--host") {
      parsed.host = value;
      index += 1;
    } else if (flag === "--root") {
      parsed.root = value;
      index += 1;
    } else {
      throw new Error(`不认识的参数：${flag}`);
    }
  }
  if (
    !Number.isInteger(parsed.port) ||
    parsed.port <= 0 ||
    parsed.port > 65535
  ) {
    throw new Error(`端口不合法：${parsed.port}`);
  }
  return parsed;
}
