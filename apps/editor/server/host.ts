/**
 * 本地服务宿主（**Node 侧**：唯一碰 `node:` 内置模块与进程的地方）。
 *
 * 职责极窄 —— 只做四件事：
 * ① 起一个**仅回环**的 HTTP 服务（端口交给内核分配，每次启动随机 token 入路径）；
 * ② 提供 `ping`（能力探测）；`{token}/open`（外部打开）；`{token}/list`（枚举工程文件）；
 * ③ 安全判据全部委托 `./security`（纯函数，可测）——本文件只做 IO 与进程；
 * ④ **不做目录浏览服务**、不提供任意文件读。
 *
 * 与前端的关系：**前端探测不到它 ⇒ 自动降级为浏览器形态**（能力探测式降级）。
 * 前端**从不假设它在**。
 *
 * 与 `media_http.rs` 同款信任边界：仅 `127.0.0.1` / 内核分配端口 / 随机 token /
 * 白名单扩展名 / 路径必须在白名单目录内。
 */
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { readdirSync, statSync, watch } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  canOpenExternal,
  isInsideRoot,
  packRequestOf,
  shouldReloadOn,
  tokenHex,
  tokenMatches,
  WATCH_IGNORED_DIRS,
} from "./security";

/** 宿主对外暴露的能力（供前端能力探测） */
export interface HostCapabilities {
  /** 是否有本地宿主 */
  readonly local: true;
  /** 能否外部打开（当前实现恒 true —— 有宿主才能走到这里） */
  readonly openExternal: true;
  /** 能否一键打包（快速出餐）—— 依赖 `lfenpack` CLI 在 PATH 上 */
  readonly pack: boolean;
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
  // 监视源根（dev 工具；失败不阻断服务启动 ⇒ 降级为「无热重载」）
  const watcher = startWatcher(root);
  const server = createServer((req, res) => {
    // 顶层兜底：请求处理器里**任何**未捕获异常都不得杀死宿主
    //   （端点里一个 `ReferenceError` 就足以把整个服务带走 ⇒ 所有能力同时失效）。
    //   这里转成 500 + 如实原因，单个坏请求只影响它自己。
    void handle(req, res, { token, root, watcher }).catch((error: unknown) => {
      try {
        json(res, 500, {
          error: "handler failed",
          reason: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // 响应已发出或已断 ⇒ 什么都不做（不二次抛出）
      }
    });
  });
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(PORT, "127.0.0.1", done);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    server,
    /** 释放监视句柄（进程退出前调；`persistent:false` 时不调也能退） */
    closeWatcher: () => watcher.close(),
    capabilities: {
      local: true,
      openExternal: true,
      pack: true,
      // **如实**反映监视是否真起来（恒 true 但未实现 = 声明与实现不一致）
      watch: watcher.watching,
      token,
      port,
      root,
    },
  };
}

/** 绝对路径 → 相对源根的逻辑路径（监视回调里判忽略要用） */
function relativePathOf(root: string, absolute: string): string {
  const rel = relative(root, absolute);
  return rel === "" ? "" : rel.replace(/\\/g, "/");
}

interface HostCtx {
  readonly token: string;
  readonly root: string;
  readonly watcher: Watcher;
}

async function handle(
  req: { url?: string; method?: string },
  res: { writeHead: (code: number, headers: Record<string, string>) => void; end: (body: string) => void },
  ctx: HostCtx,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  // 能力探测：无需 token（只回"在不在"，不泄露任何路径）
  if (url.pathname === "/__editor_host__/ping") {
    // 回 token（前端后续调用要带）但**不回任何路径**（探测是未授权可达的）
    json(res, 200, { ok: true, token: ctx.token });
    return;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  // 形态：/__editor_host__/{token}/{action}
  // **动作段必须挂在 `__editor_host__` 前缀之下**（不是裸 `/{token}/…`）：
  //   开发期前端走 Vite 同源代理，而代理只配了 `/__editor_host__` 这一个前缀 ⇒
  //   裸路径会被 Vite 自己吃掉（502/404，打不到宿主）——ping 通但 pack 404 就是这个。
  const prefix = segments[0];
  if (prefix !== "__editor_host__" || segments.length < 3) {
    json(res, 404, { error: "not found" });
    return;
  }
  const [given, action] = [segments[1], segments[2]];
  // token 不符 ⇒ 404（不区分"token 错"与"不存在"，避免被探测）
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
  if (action === "pack") {
    const body = await readBody(req as never);
    json(res, 200, await packProject(body));
    return;
  }
  if (action === "watch") {
    // 只回**变更计数**（单调整数单调递增）：前端轮询对比即可 ⇒ 不必引入 SSE/WebSocket
    json(res, 200, { revision: ctx.watcher.revision, watching: ctx.watcher.watching, root: ctx.root });
    return;
  }
  json(res, 404, { error: "not found" });
}

/**
 * 热重载监视：递归监视源根，**防抖**后累加 `revision`。
 *
 * 语义对齐 Rust `watch_project_files`（递归 + 防抖 250ms + 失败降级不崩）：
 * - **为什么必须防抖**：一次保存往往产生**多个**事件（写临时文件、rename、改内容），
 *   不防抖会让前端重载十几次；
 * - **为什么用「revision 计数」而不是推送**：前端本来就有轮询语料的机制
 *   （内容搜索），加一个更轻的轮询端点比引入 SSE 简单得多，且**不持有长连接**
 *   （回环服务被探测/扫描时不会留下悬挂连接）；
 * - **失败降级**：`fs.watch` 不支持递归（某些平台）时**只监视根目录**并如实标记
 *   `watching:false`，前端据此显示「热重载不可用」——**不假装能用**。
 */
interface Watcher {
  readonly revision: number;
  readonly watching: boolean;
  close(): void;
}

function startWatcher(root: string): Watcher {
  const state = { revision: 0, watching: false };
  const quietMs = 250;
  let timer: NodeJS.Timeout | undefined;
  const watchers: import("node:fs").FSWatcher[] = [];
  /**
   * 已登记监视的**目录**相对路径集合。
   *
   * 为什么需要它（Windows 上的实际行为，**不看文档猜不到**）：
   *   Windows 的**非递归** `fs.watch(Resources)` 在 `Stories/inn.json~` 变化时
   *   报的是 `filename = "Stories"`（**子目录名，不带内部路径**）——
   *   即「父监视器」会把「子目录内的任何变化」折叠成子目录名。
   *   若不区分，`Stories` 会被当成普通文件放行 ⇒ **每个文件变更都误递增**。
   *
   * 处置：子目录**已被单独登记**（有自己的 watcher 负责它内部的变化），
   *   父监视器这条上报是**重复的** ⇒ 忽略。既不漏（子 watcher 会报）也不重（去重）。
   */
  const watchedDirs = new Set<string>();
  const bump = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      state.revision += 1;
    }, quietMs);
  };
  const register = (dir: string): void => {
    if (watchers.length >= 512) return; // 上限：巨型目录树不炸内存
    watchedDirs.add(relativePathOf(root, dir));
    try {
      const w = watch(dir, { persistent: false }, (event, filename) => {
        if (filename === null || filename === undefined) return;
        const relative = relativePathOf(root, join(dir, String(filename)));
        // 该路径本身是**已被单独监视的目录** ⇒ 来自父监视器的重复上报，忽略
        if (watchedDirs.has(relative)) return;
        const verdict = shouldReloadOn(relative, event === "rename" ? "rename" : "change");
        if (!verdict.reload) return;
        bump();
      });
      watchers.push(w);
      state.watching = true;
    } catch {
      // 单个目录监视失败（如权限）⇒ 跳过，不影响其它
    }
  };
  register(root);
  const walk = (dir: string, depth: number): void => {
    if (depth > 8) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (WATCH_IGNORED_DIRS.has(name) || name.startsWith(".")) continue;
      const child = join(dir, name);
      try {
        if (statSync(child).isDirectory()) {
          register(child);
          walk(child, depth + 1);
        }
      } catch {
        // 读不到就跳过
      }
    }
  };
  walk(root, 1);
  return {
    get revision() {
      return state.revision;
    },
    get watching() {
      return state.watching;
    },
    close(): void {
      if (timer !== undefined) clearTimeout(timer);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // 已关闭
        }
      }
    },
  };
}

/**
 * 打包 CLI 的落位。
 *
 * 候选顺序：① 环境变量 `LFEN_PACK_BIN`（显式指定，最可控）
 * ② 仓库内 `target/{debug,release}/lfenpack[.exe]` 与 `CARGO_TARGET_DIR` 指向的共享目录
 * ③ PATH 上的 `lfenpack`
 *
 * **只 spawn 已知程序名**（候选是**我们自己拼出的路径**，不是用户输入），
 * 且一律 `shell: false`。
 */
function packBinCandidates(): string[] {
  const out: string[] = [];
  const explicit = process.env.LFEN_PACK_BIN;
  if (explicit !== undefined && explicit !== "") out.push(explicit);
  const exe = process.platform === "win32" ? ".exe" : "";
  const roots = [
    // 仓库内默认 target（无 CARGO_TARGET_DIR 时的情形）
    resolve(import.meta.dirname ?? ".", "../../playground/src-tauri/target"),
    // 本机开发环境：cargo 的共享 target 目录
    ...(process.env.CARGO_TARGET_DIR === undefined || process.env.CARGO_TARGET_DIR === ""
      ? []
      : [resolve(process.env.CARGO_TARGET_DIR)]),
  ];
  for (const root of roots) {
    out.push(join(root, "debug", `lfenpack${exe}`));
    out.push(join(root, "release", `lfenpack${exe}`));
  }
  out.push("lfenpack"); // PATH 上的裸名（spawn 自己会补 .exe）
  return out;
}

/**
 * 快速出餐：调 `lfenpack` 产出加密包。
 *
 * 安全姿态（与 `openExternal` 同款，且更严）：
 * ① 参数经 `packRequestOf` 校验（绝对路径 / 不同目录 / 不嵌套 / 无 `..`）；
 * ② `shell: false` + **参数数组**（用户可写路径绝不交给 shell 解析）；
 * ③ 采集 stdout/stderr 如实回传（不静默失败，也不假装成功）；
 * ④ 非零退出码 = 失败（`--strict` 的"报告有告警"也是非零 ⇒ 区分开告知）。
 */
async function packProject(body: string): Promise<PackResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, reason: "请求体不是合法 JSON" };
  }
  const verdict = packRequestOf(parsed);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  const args = [verdict.input, verdict.output];
  if (verdict.force) args.push("--force");
  if (verdict.strict) args.push("--strict");
  if (verdict.dist !== undefined) args.push("--dist", verdict.dist);
  return await runPack(args);
}

interface PackResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

/** 跑打包 CLI 并采集输出（**不 spawn shell**）；逐候选尝试，全失败才报"启动不了" */
async function runPack(args: readonly string[]): Promise<PackResult> {
  const candidates = packBinCandidates();
  let last: PackResult | undefined;
  for (const bin of candidates) {
    const r = await runPackOnce(bin, args);
    if (r.started) return r.result;
    last = r.result;
  }
  return (
    last ?? {
      ok: false,
      reason: "找不到 lfenpack：请 cargo build --bin lfenpack，或设 LFEN_PACK_BIN 指向可执行文件",
    }
  );
}

/** 单次尝试（`started:false` = 二进制不存在，换下一个候选） */
function runPackOnce(
  bin: string,
  args: readonly string[],
): Promise<{ started: boolean; result: PackResult }> {
  return new Promise((resolve) => {
    const child = spawn(bin, [...args], {
      shell: false,
      cwd: process.cwd(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (error: Error) => {
      // ENOENT = 该候选不存在 ⇒ 换下一个；其它错误如实报
      const notFound = (error as NodeJS.ErrnoException).code === "ENOENT";
      resolve({
        started: !notFound,
        result: notFound
          ? { ok: false, reason: "not-found" }
          : { ok: false, reason: `无法启动 ${bin}：${error.message}` },
      });
    });
    child.on("close", (code: number | null) => {
      resolve({
        started: true,
        result: {
          ok: code === 0,
          exitCode: code ?? -1,
          stdout: stdout.slice(-4000),
          stderr: stderr.slice(-4000),
          ...(code === 0 ? {} : { reason: stderr.trim() || stdout.trim() || `退出码 ${String(code)}` }),
        },
      });
    });
  });
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
  // 字符串判据**不等于**防符号链接 ⇒ 解析后复核真实路径仍在根内
  const absolute = resolve(root, verdict.relative);
  const realRoot = resolve(root);
  if (!absolute.startsWith(realRoot + sep) && absolute !== realRoot) {
    return { ok: false, reason: "路径解析后越出工程根（疑似符号链接）" };
  }
  const editor = EDITORS[0];
  try {
    const child = spawn(editor.cmd, editor.args(absolute), {
      // **不经过 shell**（用户可写路径绝不能交给 shell 解析）
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
