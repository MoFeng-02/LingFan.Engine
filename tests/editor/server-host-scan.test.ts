/**
 * Node 宿主 scan-host 端点（apps/editor/server/host.ts）：宿主未标记文案代扫。
 *
 * 三层判据：
 * - 请求判据纯函数（scanProjectOf）：单段目录名、拒绝穿越/绝对路径/多段路径；
 * - 端点行为（真实 fs 夹具 + startHost 起回环服务，内核分配端口）：
 *   扫描口径与 CLI 一致（src/ 可扫 .ts、别名清单 = 清单 i18n.functions > 缺省）、
 *   失败折 {ok:false,reason} 不杀服务、token 鉴权；
 * - 浏览器侧调用（fetchHostScan）：失败 = 能力缺席（undefined），坏条目整条丢弃。
 *
 * 另锁创作期配置域（@lingfan-engine/editor/authoring）的 resolveI18nFunctions
 * 形状校验语义（自 cli/i18n-io.ts 原样搬入，文案唯一源不变）。
 */
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanProjectOf } from "../../apps/editor/server/security";
import {
  fetchHostScan,
  type LocalHostEndpoint,
} from "../../apps/editor/src/infra/localHost";
import { resolveI18nFunctions } from "../../packages/editor/src/authoring/index.ts";
import type { HostScanResult } from "../../apps/editor/src/contracts/host";

/* ——— 请求判据：单段目录名 ——— */

describe("scanProjectOf：请求判据", () => {
  it("合法单段目录名 ⇒ 放行", () => {
    expect(scanProjectOf({ project: "my-game" })).toEqual({
      ok: true,
      relative: "my-game",
    });
  });

  it("缺 project / 非字符串 ⇒ 明确拒绝", () => {
    expect(scanProjectOf({})).toEqual({
      ok: false,
      reason: "请求体缺少 project（工程根目录名）",
    });
    expect(scanProjectOf(null).ok).toBe(false);
    expect(scanProjectOf({ project: 42 })).toEqual({
      ok: false,
      reason: "project 必须是字符串（工程根目录名）",
    });
  });

  it("多段路径 / 穿越 / 绝对路径 / 盘符 ⇒ 拒绝", () => {
    expect(scanProjectOf({ project: "a/b" })).toEqual({
      ok: false,
      reason: "project 必须是单段目录名（不接受路径）",
    });
    expect(scanProjectOf({ project: ".." }).ok).toBe(false);
    expect(scanProjectOf({ project: "/etc" }).ok).toBe(false);
    expect(scanProjectOf({ project: "C:/x" }).ok).toBe(false);
    expect(scanProjectOf({ project: "" }).ok).toBe(false);
  });
});

/* ——— 端点行为：真实 fs 夹具 + 回环服务 ——— */

const HOST_SOURCE =
  'export const title = t("宿主键");\nexport const raw = "未标记文案";\n';

let root: string;
let server: Server | undefined;
let closeWatcher: (() => void) | undefined;
let endpoint: LocalHostEndpoint;

async function write(rel: string, content: string): Promise<void> {
  const target = path.join(root, rel);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, content, "utf8");
}

async function boot(hostRoot: string): Promise<void> {
  // 端口环境变量必须在模块求值前设好（host.ts 的 PORT 是模块级常量）⇒ 动态导入
  vi.stubEnv("LFEN_EDITOR_HOST_PORT", "0"); // 内核分配端口，不与既有服务相撞
  const { startHost } = await import("../../apps/editor/server/host");
  const started = await startHost(hostRoot);
  server = started.server;
  closeWatcher = started.closeWatcher;
  endpoint = {
    baseUrl: `http://127.0.0.1:${started.capabilities.port}`,
    token: started.capabilities.token,
  };
}

/** 直连端点（绕开 fetchHostScan 的窄化，看线上原始形状） */
async function post(
  body: string,
  token = endpoint.token,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(
    `${endpoint.baseUrl}/__editor_host__/${token}/scan-host`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    },
  );
  return { status: res.status, json: await res.json() };
}

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(tmpdir(), "lingfan-scan-host-"));
});
afterEach(async () => {
  closeWatcher?.();
  closeWatcher = undefined;
  if (server !== undefined) {
    await new Promise<void>((done) => server?.close(() => done()));
    server = undefined;
  }
  vi.unstubAllEnvs();
  await fsp.rm(root, { recursive: true, force: true });
});

describe("scan-host 端点：扫描口径与 CLI 一致", () => {
  it("宿主根即工程：报未标记文案（file 相对工程根、1 基坐标）", async () => {
    await write("src/host/main.ts", HOST_SOURCE);
    await boot(root);
    const { status, json } = await post(
      JSON.stringify({ project: path.basename(root) }),
    );
    expect(status).toBe(200);
    const result = json as HostScanResult;
    expect(result.ok).toBe(true);
    expect(result.unmarked).toEqual([
      { file: "src/host/main.ts", line: 2, column: 20, text: "未标记文案" },
    ]);
  });

  it("多工程父目录：按名定位子目录工程", async () => {
    await write("game-a/src/main.ts", HOST_SOURCE);
    await boot(root);
    const { json } = await post(JSON.stringify({ project: "game-a" }));
    const result = json as HostScanResult;
    expect(result.ok).toBe(true);
    expect(result.unmarked?.[0]?.file).toBe("src/main.ts");
  });

  it("别名清单生效：i18n.functions 登记的 tr() 算已标记", async () => {
    await write(
      "Resources/project.json",
      JSON.stringify({ i18n: { functions: ["tr"] } }),
    );
    await write(
      "src/main.ts",
      'export const a = tr("已标记");\nexport const b = t("未登记别名");\n',
    );
    await boot(root);
    const { json } = await post(
      JSON.stringify({ project: path.basename(root) }),
    );
    const result = json as HostScanResult;
    expect(result.ok).toBe(true);
    // t 不在别名清单里 ⇒ 它的中文实参算未标记；tr 的算已标记
    expect(result.unmarked?.map((s) => s.text)).toEqual(["未登记别名"]);
  });

  it("不可扫文件跳过：.vue / .d.ts / node_modules 不进扫描", async () => {
    await write("src/main.ts", HOST_SOURCE);
    await write("src/view.vue", "<template>未标记</template>");
    await write("src/types.d.ts", 'export declare const x: "未标记";');
    await write("src/node_modules/dep.ts", 'export const y = "未标记";');
    await boot(root);
    const { json } = await post(
      JSON.stringify({ project: path.basename(root) }),
    );
    const result = json as HostScanResult;
    expect(result.ok).toBe(true);
    expect(result.unmarked?.map((s) => s.file)).toEqual(["src/main.ts"]);
  });
});

describe("scan-host 端点：失败折拒绝、不杀服务", () => {
  it("工程目录不在 ⇒ ok:false 带原因", async () => {
    await boot(root);
    const { json } = await post(JSON.stringify({ project: "no-such-dir" }));
    expect(json).toEqual({
      ok: false,
      reason: "工程目录不存在：no-such-dir",
    });
  });

  it("缺 src/ ⇒ ok:false；坏请求体 ⇒ ok:false", async () => {
    await write("Resources/project.json", "{}");
    await boot(root);
    const noSrc = await post(JSON.stringify({ project: path.basename(root) }));
    expect(noSrc.json).toEqual({
      ok: false,
      reason: "工程缺少 src/ 宿主源码目录",
    });
    const badBody = await post("{not json");
    expect(badBody.json).toEqual({ ok: false, reason: "请求体不是合法 JSON" });
  });

  it("清单坏 JSON / 别名清单非法 ⇒ ok:false 文案与 CLI 同源", async () => {
    await write("src/main.ts", HOST_SOURCE);
    await write("Resources/project.json", "{broken");
    await boot(root);
    const broken = (await post(
      JSON.stringify({ project: path.basename(root) }),
    )) as { json: HostScanResult };
    expect(broken.json.ok).toBe(false);
    expect(broken.json.reason).toContain("project.json 不是合法 JSON：");
    // 别名清单空数组 ⇒ 装载先验 fail-closed（文案唯一源在扫描域）
    await write(
      "Resources/project.json",
      JSON.stringify({ i18n: { functions: [] } }),
    );
    const empty = (await post(
      JSON.stringify({ project: path.basename(root) }),
    )) as { json: HostScanResult };
    expect(empty.json).toEqual({
      ok: false,
      reason: "i18n.functions 别名清单不能为空（至少登记一个函数名，如 t）",
    });
  });

  it("token 不符 ⇒ 404（与既有端点同口径）", async () => {
    await write("src/main.ts", HOST_SOURCE);
    await boot(root);
    const { status } = await post(
      JSON.stringify({ project: path.basename(root) }),
      "wrong-token",
    );
    expect(status).toBe(404);
  });
});

/* ——— 浏览器侧调用：能力缺席语义 ——— */

describe("fetchHostScan：失败 = 能力缺席，不抛", () => {
  const host: LocalHostEndpoint = {
    baseUrl: "http://127.0.0.1:1",
    token: "tok",
  };
  const reply = (body: unknown, ok = true): typeof fetch =>
    (async () =>
      ({ ok, json: async () => body }) as Response) as unknown as typeof fetch;

  it("正常应答 ⇒ 窄化后的 HostScanResult", async () => {
    const result = await fetchHostScan(
      host,
      "game",
      reply({
        ok: true,
        unmarked: [
          { file: "src/a.ts", line: 1, column: 2, text: "文案" },
          { file: "src/b.ts", line: "坏坐标", column: 3, text: "丢弃" },
          null,
        ],
      }),
    );
    expect(result).toEqual({
      ok: true,
      unmarked: [{ file: "src/a.ts", line: 1, column: 2, text: "文案" }],
    });
  });

  it("ok:false 透传 reason（组合根据此不填字段）", async () => {
    const result = await fetchHostScan(
      host,
      "game",
      reply({ ok: false, reason: "工程缺少 src/ 宿主源码目录" }),
    );
    expect(result).toEqual({
      ok: false,
      reason: "工程缺少 src/ 宿主源码目录",
    });
  });

  it("HTTP 失败 / 形状不对 / 网络错 ⇒ undefined", async () => {
    expect(
      await fetchHostScan(host, "game", reply({ ok: true }, false)),
    ).toBeUndefined();
    expect(await fetchHostScan(host, "game", reply({}))).toBeUndefined();
    expect(
      await fetchHostScan(host, "game", reply({ ok: "yes" })),
    ).toBeUndefined();
    const throwing = (async () => {
      throw new Error("连接拒绝");
    }) as unknown as typeof fetch;
    expect(await fetchHostScan(host, "game", throwing)).toBeUndefined();
  });

  it("请求只带工程根目录名（POST scan-host，线上形状锁定）", async () => {
    let seenUrl = "";
    let seenBody = "";
    const spy = (async (url: string, init?: { body?: string }) => {
      seenUrl = url;
      seenBody = init?.body ?? "";
      return { ok: true, json: async () => ({ ok: true, unmarked: [] }) };
    }) as unknown as typeof fetch;
    await fetchHostScan(host, "my-game", spy);
    expect(seenUrl).toBe("http://127.0.0.1:1/__editor_host__/tok/scan-host");
    expect(JSON.parse(seenBody)).toEqual({ project: "my-game" });
  });
});

/* ——— 创作期配置域：resolveI18nFunctions（自 cli/i18n-io 原样搬入） ——— */

describe("authoring：resolveI18nFunctions 形状校验", () => {
  it("缺席 ⇒ undefined（未配置，扫描器用缺省别名）", () => {
    expect(resolveI18nFunctions(undefined)).toBeUndefined();
    expect(resolveI18nFunctions(null)).toBeUndefined();
    expect(resolveI18nFunctions({})).toBeUndefined();
    expect(resolveI18nFunctions({ i18n: null })).toBeUndefined();
    expect(resolveI18nFunctions({ i18n: {} })).toBeUndefined();
  });

  it("合法清单原样返回（含空数组与空名——判定归扫描域先验）", () => {
    expect(resolveI18nFunctions({ i18n: { functions: ["t", "tr"] } })).toEqual([
      "t",
      "tr",
    ]);
    expect(resolveI18nFunctions({ i18n: { functions: [] } })).toEqual([]);
    expect(resolveI18nFunctions({ i18n: { functions: [""] } })).toEqual([""]);
  });

  it("形状非法 ⇒ fail-closed，文案与 CLI 同源", () => {
    expect(() => resolveI18nFunctions({ i18n: [] })).toThrow(
      "project.json 的 i18n 段必须是对象（i18n.functions 别名清单住在这里）",
    );
    expect(() => resolveI18nFunctions({ i18n: { functions: "t" } })).toThrow(
      'project.json 的 i18n.functions 必须是字符串数组（如 ["t", "tr"]）',
    );
    expect(() =>
      resolveI18nFunctions({ i18n: { functions: ["t", 3] } }),
    ).toThrow(
      'project.json 的 i18n.functions 必须是字符串数组（如 ["t", "tr"]）',
    );
  });
});
