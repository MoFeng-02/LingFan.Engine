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
  packRequestOf,
  shouldReloadOn,
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
  const TOKEN = "a".repeat(32);
  /** 宿主 ping 的应答：**必须带 token**（前端后续调用要靠它） */
  const pong = (body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 }) as never);

  it("命中**绝对**候选 ⇒ 返回 `{baseUrl, token}`", async () => {
    const seen: string[] = [];
    const host = await detectLocalHost(async (input) => {
      seen.push(String(input));
      // 第一个（相对）候选失败 ⇒ 落到绝对候选并命中
      if (String(input).startsWith("/")) return new Response("", { status: 500 }) as never;
      return pong({ ok: true, token: TOKEN });
    });
    expect(host).toEqual({ baseUrl: "http://127.0.0.1:14250", token: TOKEN });
    expect(seen).toEqual(["/__editor_host__/ping", "http://127.0.0.1:14250/__editor_host__/ping"]);
  });

  it("**响应无 token ⇒ 不算命中**（别的服务恰好 200 也不认）", async () => {
    const host = await detectLocalHost(async () => pong({ ok: true }));
    expect(host).toBeUndefined();
  });

  it("token 为空串 ⇒ 不算命中", async () => {
    const host = await detectLocalHost(async () => pong({ ok: true, token: "" }));
    expect(host).toBeUndefined();
  });

  it("响应不是 JSON ⇒ 不算命中（容错不抛）", async () => {
    const host = await detectLocalHost(
      async () => new Response("not json", { status: 200 }) as never,
    );
    expect(host).toBeUndefined();
  });

  it("全部候选失败 ⇒ undefined（**不抛错**：无宿主是正常形态）", async () => {
    const host = await detectLocalHost(() => Promise.reject(new Error("ECONNREFUSED")));
    expect(host).toBeUndefined();
  });

  it("非 200 不算命中（继续试下一个）", async () => {
    let call = 0;
    const host = await detectLocalHost(async () => {
      call += 1;
      return call === 1
        ? (new Response("", { status: 500 }) as never)
        : pong({ ok: true, token: TOKEN });
    });
    expect(call).toBe(2);
    expect(host).toBeDefined();
  });

  it("请求异常（宿主崩）⇒ 当作无宿主", async () => {
    const host = await detectLocalHost(() => Promise.reject(new Error("boom")));
    expect(host).toBeUndefined();
  });
});

describe("打包判据 · 路径安全（本机最危险的动作）", () => {
  const ok = { input: "E:/proj/game", output: "E:/dist/game" };

  it("正常绝对路径放行", () => {
    const v = packRequestOf(ok);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.input).toBe("E:/proj/game");
      expect(v.output).toBe("E:/dist/game");
      expect(v.force).toBe(false);
      expect(v.strict).toBe(false);
      expect(v.dist).toBeUndefined();
    }
  });

  it("**拒绝相对路径**（基准不确定 ⇒ 不猜）", () => {
    for (const bad of [
      { ...ok, input: "proj/game" },
      { ...ok, output: "dist/game" },
      { ...ok, input: "./game" },
    ]) {
      const v = packRequestOf(bad);
      expect(v.ok, JSON.stringify(bad)).toBe(false);
      if (!v.ok) expect(v.reason).toContain("绝对路径");
    }
  });

  it("**拒绝 input === output**（--force 会把源工程清空）", () => {
    const v = packRequestOf({ input: "E:/proj/game", output: "E:/proj/game" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("不能与工程根相同");
  });

  it("**拒绝输出位于工程根之内**", () => {
    const v = packRequestOf({ input: "E:/proj/game", output: "E:/proj/game/dist" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("之内");
  });

  it("**拒绝工程根位于输出之内**（--force 清空输出会连带删工程）", () => {
    const v = packRequestOf({ input: "E:/proj/game/src", output: "E:/proj/game" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("之内");
  });

  it("拒绝 `..` 段（各种分隔符形态）", () => {
    for (const bad of [
      { input: "E:/proj/../game", output: "E:/dist" },
      { input: "E:/proj", output: "E:/dist/../out" },
      { input: "E://proj//..//game", output: "E:/dist" },
    ]) {
      expect(packRequestOf(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("拒绝坏形状（null / 非对象 / 缺字段 / 非字符串）", () => {
    for (const bad of [null, "x", 42, {}, { input: "E:/a" }, { output: "E:/b" }, { input: 1, output: 2 }]) {
      expect(packRequestOf(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("尾斜杠归一后仍能识别同目录（`E:/proj/game/` vs `E:/proj/game`）", () => {
    const v = packRequestOf({ input: "E:/proj/game/", output: "E:/proj/game" });
    expect(v.ok).toBe(false);
  });

  it("`force` / `strict` 只认布尔真值（字符串 \"true\" 不算）", () => {
    const v = packRequestOf({ ...ok, force: "true", strict: 1 });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.force).toBe(false);
      expect(v.strict).toBe(false);
    }
  });

  it("dist 可选；给了就必须是绝对路径且无 `..`", () => {
    expect(packRequestOf({ ...ok, dist: "E:/build" }).ok).toBe(true);
    expect(packRequestOf({ ...ok, dist: "" }).ok).toBe(true); // 空 = 不给
    expect(packRequestOf({ ...ok, dist: null }).ok).toBe(true);
    expect(packRequestOf({ ...ok, dist: "build" }).ok).toBe(false);
    expect(packRequestOf({ ...ok, dist: "E:/../build" }).ok).toBe(false);
  });

  it("POSIX 绝对路径也认（跨平台判据不留 Windows-only 洞）", () => {
    const v = packRequestOf({ input: "/home/u/proj", output: "/tmp/out" });
    expect(v.ok).toBe(true);
  });
});

describe("热重载判据 · 该不该因这次变更重载", () => {
  it("正常内容变更 ⇒ 重载", () => {
    for (const p of ["Stories/start.json", "Lang/en/main.json", "project.json", "src/main.ts", "Saves/slot_1.json"]) {
      expect(shouldReloadOn(p, "change").reload, p).toBe(true);
    }
  });

  it("**构建产物/版本库目录一律不重载**（否则每次 build/git 都刷一遍）", () => {
    for (const p of [
      "node_modules/x/y.js",
      "target/debug/lingfan.exe",
      "dist/assets/index.js",
      ".git/HEAD",
      "a/node_modules/b/c.js",
    ]) {
      expect(shouldReloadOn(p, "change").reload, p).toBe(false);
    }
  });

  it("**临时/备份文件不重载**（编辑器写盘的中间态不是真内容）", () => {
    for (const p of [
      "Stories/start.json~",
      "Stories/.start.json.swp",
      "Stories/start.json.swo",
      "Stories/~$start.json",
      "Stories/.#start.json",
      "x.tmp",
    ]) {
      expect(shouldReloadOn(p, "change").reload, p).toBe(false);
    }
  });

  it("点文件不重载（`.gitignore`/`.env` 等；枚举口径本就剔除）", () => {
    expect(shouldReloadOn(".gitignore", "change").reload).toBe(false);
    expect(shouldReloadOn(".env", "change").reload).toBe(false);
  });

  it("**`.env` 这类点文件仍可被 `canOpenExternal` 放行**（两条判据互不干扰）", () => {
    expect(shouldReloadOn(".env", "change").reload).toBe(false);
    expect(canOpenExternal(".env").ok).toBe(true);
  });

  it("**不忽略 `Saves/`**（存档是作者数据，与 Rust 侧监视整个源根一致）", () => {
    expect(shouldReloadOn("Saves/slot_1.json", "change").reload).toBe(true);
  });

  it("Windows 反斜杠路径同样判得住", () => {
    expect(shouldReloadOn("Stories\\start.json", "change").reload).toBe(true);
    expect(shouldReloadOn("node_modules\\x\\y.js", "change").reload).toBe(false);
  });

  it("空路径 / 无有效段 ⇒ 不重载（不抛）", () => {
    expect(shouldReloadOn("", "change").reload).toBe(false);
    expect(shouldReloadOn(".", "change").reload).toBe(false);
  });

  it("增删（rename）与内容变更都重载，但理由不同", () => {
    expect(shouldReloadOn("Stories/new.json", "rename")).toMatchObject({ reload: true, reason: "文件增删" });
    expect(shouldReloadOn("Stories/start.json", "change")).toMatchObject({ reload: true, reason: "内容变更" });
  });

  it("删目录时 path 就是目录本身 ⇒ 末段也要查忽略表", () => {
    expect(shouldReloadOn("node_modules", "rename").reload).toBe(false);
    expect(shouldReloadOn("Stories", "rename").reload).toBe(true);
  });
});
