/**
 * 本地服务宿主（**Node 侧**：唯一碰 `node:` 内置模块与进程的地方）。
 *
 * 职责极窄 —— 只做四件事：
 * ① 起一个**仅回环**的 HTTP 服务（端口交给内核分配，每次启动随机 token 入路径）；
 * ② 提供 `ping`（能力探测）；`{token}/open`（外部打开）；`{token}/list`（枚举工程文件）；
 * ③ 安全判据全部委托 `./security`（纯函数，可测）——本文件只做 IO 与进程；
 * ④ **不做目录浏览服务**、不提供任意文件读。
 *
 * 与前端的关系：**前端探测不到它 ⇒ 自动降级为浏览器形态**（能力探测式降级，
 * 规划稿 §2.2④）。前端**从不假设它在**。
 *
 * 与 `media_http.rs` 同款信任边界：仅 `127.0.0.1` / 内核分配端口 / 随机 token /
 * 白名单扩展名 / 路径必须在白名单目录内。
 */
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { canOpenExternal, isInsideRoot, tokenHex, tokenMatches } from "./security";

/** 宿主对外暴露的能力（供前端能力探测） */
export interface HostCapabilities {
  /** 是否有本地宿主 */
  readonly local: true;
  /** 能否外部打开（当前实现恒 true —— 有宿主才能走到这里） */
  readonly openExternal: true;
  /** 是否支持原生文件监视 */
  readonly watch: boolean;
  readonly token: string;
  readonly port: number;
  /** 服务根（工程所在目录的绝对路径，**仅供显示**） */
  readonly root: string;
}

const TOKEN_BYTES = 16;
/** 单次请求体上限（外部打开只发路径，不发内容 ⇒ 极小） */
const MAX_BODY = 8 * 1024;

function json(res: { writeHead: (code: number, headers: Record<string, string>) => void; end: (body: string) => void }, code: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text).toString() });
  res.end(text);
}

/** 收集请求体（带上限，超限即拒） */
function readBody(req: { on: (e: string, cb: (chunk?: unknown) => void) => void }): Promise<string> {
  return new Promise((resolvePromise) => {
    let size = 0;
    let text = "";
    req.on("data", (chunk?: unknown) => {
      const buf = chunk as Buffer;
      size += buf.length;
      if (size > MAX_BODY) {
        text = "";
        return;
      }
      text += buf.toString("utf8");
    });
    req.on("end", () => resolvePromise(text));
  });
}

/** 候选编辑器（**只 spawn 已知程序**，绝不把用户可写路径直接交给 shell） */
const EDITORS: readonly { cmd: string; args: (file: string) => string[] }[] = [
  // 优先走 URI 协议（VS Code / Cursor 自注册，无需猜可执行文件名）
  { cmd: "code", args: (f) => ["--goto", f] },
  { cmd: "cursor", args: (f) => ["--goto", f] },
];

/**
 * 起本地服务。**端口由内核分配**（`:0`）⇒ 不与既有服务撞端口。
 * @param root 工程根的绝对路径（资源根的父目录 —— `Resources/` 与 `src/` 都在它之下）
 */
/** 监听端口：开发期固定（Vite 代理要指向它）；`0` = 内核分配（生产期用） */
const PORT = Number(process.env.LFEN_EDITOR_HOST_PORT ?? 14250);

export async function startHost(root: string): Promise<{ server: Server; capabilities: HostCapabilities }> {
  const token = tokenHex(randomBytes(TOKEN_BYTES));
  const server = createServer((req, res) => {
    void handle(req, res, { token, root });
  });
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(PORT, "127.0.0.1", done);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    server,
    capabilities: { local: true, openExternal: true, watch: true, token, port, root },
  };
}

interface HostCtx {
  readonly token: string;
  readonly root: string;
}

async function handle(
  req: { url?: string; method?: string },
  res: { writeHead: (code: number, headers: Record<string, string>) => void; end: (body: string) => void },
  ctx: HostCtx,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  // 能力探测：无需 token（只回"在不在"，不泄露任何路径）
  if (url.pathname === "/__editor_host__/ping") {
    json(res, 200, { ok: true });
    return;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  // 形态：/{token}/open | /{token}/list
  if (segments.length < 2) {
    json(res, 404, { error: "not found" });
    return;
  }
  const [given, action] = segments;
  // ⚠️ token 不符 ⇒ 404（不区分"token 错"与"不存在"，避免被探测）
  if (!tokenMatches(ctx.token, given ?? null)) {
    json(res, 404, { error: "not found" });
    return;
  }
  if (action === "list") {
    json(res, 200, { files: listFiles(ctx.root) });
    return;
  }
  if (action === "open") {
    const body = await readBody(req as never);
    json(res, 200, await openExternal(body, ctx.root));
    return;
  }
  json(res, 404, { error: "not found" });
}

/** 枚举工程文件（相对路径，码元序；跳过点文件与 node_modules） */
function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string, depth: number): void => {
    // 深度上限：防符号链接/巨型目录导致的遍历爆炸
    if (depth > 8) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      if (name.startsWith(".") || name === "node_modules" || name === "target") continue;
      const relative = prefix === "" ? name : `${prefix}/${name}`;
      const absolute = join(dir, name);
      try {
        if (statSync(absolute).isDirectory()) walk(absolute, relative, depth + 1);
        else out.push(relative);
      } catch {
        // 读不到（权限/竞态）就跳过，不让整次枚举失败
      }
    }
  };
  walk(root, "", 0);
  return out.sort();
}

/** 外部打开：白名单判据 + realpath 复核 + 只 spawn 已知编辑器 */
async function openExternal(body: string, root: string): Promise<{ ok: boolean; reason?: string }> {
  let relative = "";
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && "path" in parsed) {
      const value = (parsed as { path: unknown }).path;
      if (typeof value === "string") relative = value;
    }
  } catch {
    return { ok: false, reason: "请求体不是合法 JSON" };
  }
  const verdict = canOpenExternal(relative);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  if (!isInsideRoot(verdict.relative)) return { ok: false, reason: "路径不在工程根内" };
  // ⚠️ 字符串判据**不等于**防符号链接 ⇒ 解析后复核真实路径仍在根内
  const absolute = resolve(root, verdict.relative);
  const realRoot = resolve(root);
  if (!absolute.startsWith(realRoot + sep) && absolute !== realRoot) {
    return { ok: false, reason: "路径解析后越出工程根（疑似符号链接）" };
  }
  const editor = EDITORS[0];
  try {
    const child = spawn(editor.cmd, editor.args(absolute), {
      // ⚠️ **不经过 shell**（用户可写路径绝不能交给 shell 解析）
      shell: false,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, reason: `启动 ${editor.cmd} 失败：${error instanceof Error ? error.message : String(error)}` };
  }
}
