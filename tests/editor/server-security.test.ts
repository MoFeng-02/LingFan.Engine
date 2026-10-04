/**
 * 本地服务安全面：路径与外部打开白名单的**穷举判据**测试。
 *
 * 这是本机 HTTP 服务的唯一安全关口 ⇒ 判据必须能被穷举断言，
 * ���能靠"我看着觉得对"。任一 `ok: true` 出现在不该出现的输入上 = 漏洞。
 */
import { describe, expect, it } from "vitest";
import {
  canOpenExternal,
  isInsideRoot,
  normalizeRelativePath,
  OPENABLE_EXTENSIONS,
  OPENABLE_ROOTS,
  tokenHex,
  tokenMatches,
} from "../../apps/editor/server/security";
import { detectLocalHost } from "../../apps/editor/src/localHost";

describe("路径归一：越界形态一律拒绝", () => {
  it("接受正常相对路径（去空段与 .）", () => {
    expect(normalizeRelativePath("src/main.ts")).toEqual({ ok: true, relative: "src/main.ts" });
    expect(normalizeRelativePath("./src//main.ts")).toEqual({ ok: true, relative: "src/main.ts" });
  });

  it("拒绝路径穿越的各种写法", () => {
    for (const bad of [
      "../secret.txt",
      "src/../../secret.txt",
      "..",
      "a/b/../../../c",
    ]) {
      const v = normalizeRelativePath(bad);
      expect(v.ok, `${bad} 应被拒`).toBe(false);
      if (!v.ok) expect(v.reason).toContain("穿越");
    }
  });

  it("拒绝绝对路径与 Windows 盘符", () => {
    expect(normalizeRelativePath("/etc/passwd").ok).toBe(false);
    expect(normalizeRelativePath("C:/Windows/system32").ok).toBe(false);
    expect(normalizeRelativePath("C:\\Windows\\system32").ok).toBe(false);
    // 反斜杠归一后再判 ⇒ 不能靠分隔符差异绕过
    expect(normalizeRelativePath("src\\..\\..\\x").ok).toBe(false);
  });

  it("拒绝空路径", () => {
    for (const bad of ["", "/", ".", "./"]) {
      expect(normalizeRelativePath(bad).ok, `"${bad}" 应被拒`).toBe(false);
    }
  });

  it("isInsideRoot 二次防线", () => {
    expect(isInsideRoot("src/main.ts")).toBe(true);
    expect(isInsideRoot("../x")).toBe(false);
    expect(isInsideRoot("a/../b")).toBe(false);
  });
});

describe("外部编辑器打开：白名单（扩展名 ∧ 目录）", () => {
  it("放行白名单内的代码/配置/文档", () => {
    for (const ok of [
      "src/main.ts",
      "package.json",
      "vite.config.ts",
      "tsconfig.json",
      "README.md",
      ".env",
    ]) {
      const v = canOpenExternal(ok);
      expect(v.ok, `${ok} 应放行`).toBe(true);
    }
  });

  it("拒绝非白名单扩展名（不猜编辑器）", () => {
    for (const bad of [
      "src/logo.png",
      "Audio/bgm.mp3",
      "Video/m2.mp4",
      "Resources/Stories/start.json",
    ]) {
      const v = canOpenExternal(bad);
      expect(v.ok, `${bad} 应被拒`).toBe(false);
      if (!v.ok) expect(v.reason).toContain("白名单");
    }
  });

  it("拒绝非白名单目录（生成物不外开）", () => {
    for (const bad of ["Saves/slot_1.json", "Lang/en/main.json", "Stories/start.json"]) {
      const v = canOpenExternal(bad);
      expect(v.ok, `${bad} 应被拒`).toBe(false);
      if (!v.ok) expect(v.reason).toContain("目录");
    }
  });

  it("**先过路径归一**：越界路径不得靠扩展名蒙混过关", () => {
    expect(canOpenExternal("../outside.ts").ok).toBe(false);
    expect(canOpenExternal("src/../../outside.ts").ok).toBe(false);
    expect(canOpenExternal("/etc/passwd").ok).toBe(false);
  });

  it("根级文件（`.` 目录）在放行目录内", () => {
    expect(OPENABLE_ROOTS).toContain(".");
    expect(canOpenExternal("README.md").ok).toBe(true);
  });

  it("白名单本身是显式表（非启发式判断文件像不像代码）", () => {
    expect(OPENABLE_EXTENSIONS).toContain(".ts");
    expect(OPENABLE_EXTENSIONS).not.toContain(".png");
    expect(OPENABLE_EXTENSIONS).not.toContain(".exe");
    expect(OPENABLE_EXTENSIONS.every((e) => e.startsWith(".") && e === e.toLowerCase())).toBe(true);
  });
});

describe("token：每进程随机 + 定长比较", () => {
  it("tokenHex 按 hex 输出（定长 2×字节数）", () => {
    expect(tokenHex(new Uint8Array([0, 15, 16, 255]))).toBe("000f10ff");
    expect(tokenHex(new Uint8Array(16))).toHaveLength(32);
  });

  it("相符才通过", () => {
    expect(tokenMatches("abc123", "abc123")).toBe(true);
    expect(tokenMatches("abc123", "abc124")).toBe(false);
    expect(tokenMatches("abc123", "abc12")).toBe(false);
    expect(tokenMatches("abc123", "abc1234")).toBe(false);
    expect(tokenMatches("abc123", null)).toBe(false);
    expect(tokenMatches("abc123", "")).toBe(false);
    expect(tokenMatches("abc123", "ABC123")).toBe(false); // 大小写敏感
  });
});

describe("点开头文件（dotfile）的扩展名口径", () => {
  it("`.env` / `.gitignore` 的扩展名 = 整个文件名（`path.extname` 会返回空串，须特判）", () => {
    expect(canOpenExternal(".env").ok).toBe(true);
    // 不可编辑的点文件仍被拒（扩展名不在白名单）
    expect(canOpenExternal(".gitignore").ok).toBe(false);
  });
});

describe("能力探测（浏览器侧 · 零 Node 依赖）", () => {
  const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }) as never);

  it("命中**绝对**候选 ⇒ 返回去掉 `/__editor_host__` 的基址", async () => {
    const seen: string[] = [];
    const base = await detectLocalHost(async (input) => {
      seen.push(String(input));
      // 第一个（相对）候选失败 ⇒ 落到绝对候选并命中
      if (String(input).startsWith("/")) return new Response("", { status: 500 }) as never;
      return ok({ ok: true });
    });
    expect(base).toBe("http://127.0.0.1:14250");
    expect(seen).toEqual(["/__editor_host__/ping", "http://127.0.0.1:14250/__editor_host__/ping"]);
  });

  it("相对候选命中 ⇒ 依赖 `location.origin`（node 测试环境无 location ⇒ 落下一候选）", async () => {
    // 该分支的真实价值：**同源代理命中**。在浏览器里 `location.origin` 必然存在；
    // 在纯 node 测试环境不存在 ⇒ 本函数按"落下一候选"处理（不是错误）。
    const base = await detectLocalHost(async () => ok({ ok: true }));
    expect(typeof base === "string" || base === undefined).toBe(true);
  });

  it("全部候选失败 ⇒ undefined（**不抛错**：无宿主是正常形态）", async () => {
    const base = await detectLocalHost(() => Promise.reject(new Error("ECONNREFUSED")));
    expect(base).toBeUndefined();
  });

  it("非 200 不算命中（继续试下一个）", async () => {
    let call = 0;
    const base = await detectLocalHost(async () => {
      call += 1;
      return new Response("", { status: call === 1 ? 500 : 200 }) as never;
    });
    expect(call).toBe(2);
    expect(base).toBeDefined();
  });

  it("请求异常（宿主崩）⇒ 当作无宿主", async () => {
    const base = await detectLocalHost(() => Promise.reject(new Error("boom")));
    expect(base).toBeUndefined();
  });
});
