/**
 * Tauri 桥接域的装载期约束：`invoke` / `listen` 由组合根装进来，包内不出现 Tauri 模块名。
 *
 * 为什么这条要有测试守着：适配器包是给外部工程消费的源码包，`@tauri-apps/api` 是它自己的
 * 依赖、不是消费方工程的依赖。两条动态导入的路都验证过会坏——
 * 写字面量说明符，打包器（Rollup 与基于它的 vite / uni）会静态解析它并塞进构建图，
 * 浏览器与小程序形态明明走不到桌面分支，却在构建期以 `Rollup failed to resolve import`
 * 失败；写成变量说明符，打包器放过它，但产物里残留裸模块名，WebView 执行时抛
 * `TypeError: Module name ... does not resolve to a valid URL`，前端入口整体挂掉。
 * 所以本包对 Tauri 运行时零认知，只认契约；模块名留在组合根。
 *
 * 手法：源码当文本扫（`?raw`），每条断言先自检扫描面非空，再验证「未装配即 fail-closed」
 * 与「装配后转调」两条运行时行为——「glob 写错 ⇒ 空扫描 ⇒ 绿」是已知假绿形态。
 */
import { describe, expect, it } from "vitest";
// 桥接域的实现文件不在包对外出口面上（出口只给契约与装配入口），故按相对路径取源码
import {
  defaultInvoke,
  defaultListen,
  installTauriBridge,
  TauriBridgeError,
  type TauriBridge,
} from "../../../packages/adapters/src/platform/tauri-invoke.ts";

/** 包内全部源码（键 = 相对本测试文件的 glob 模式） */
const PACKAGE_SOURCE_FILES = import.meta.glob(
  "../../../packages/*/src/**/*.ts",
  {
    eager: true,
    query: "?raw",
    import: "default",
  },
) as Record<string, string>;

/** Tauri 运行时的模块名：本包的**代码**里任何一处都不该出现（注释里解释缘由是允许的） */
const TAURI_MODULE = "@tauri-apps/";

/**
 * 剥掉行注释与块注释，只留代码骨架。
 * 注释里点名该模块是刻意的（说明为什么不写它），判据必须落在代码上，否则
 * 「把缘由写清楚」反而会把测试逼成红灯。
 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      out += " ";
      continue;
    }
    if (two === "//") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
      continue;
    }
    out += source.charAt(i);
    i += 1;
  }
  return out;
}

/** 按文件路径列出代码里提到 Tauri 模块名的行（无命中返回空表） */
function tauriModuleMentions(): Array<{ path: string; line: string }> {
  const hits: Array<{ path: string; line: string }> = [];
  for (const [path, source] of Object.entries(PACKAGE_SOURCE_FILES)) {
    for (const line of stripComments(source).split("\n")) {
      if (line.includes(TAURI_MODULE)) hits.push({ path, line });
    }
  }
  return hits;
}

/** 记录装配进桥的函数是否被按契约调用（替身只记参数、不做真实 IPC） */
function spyBridge(): {
  bridge: TauriBridge;
  calls: Array<{ kind: string; args: unknown[] }>;
} {
  const calls: Array<{ kind: string; args: unknown[] }> = [];
  return {
    calls,
    bridge: {
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ kind: "invoke", args: [command, args] });
        return { echoed: command } as T;
      },
      listen: async (event: string, handler: () => void) => {
        calls.push({ kind: "listen", args: [event] });
        handler();
        return () => calls.push({ kind: "unlisten", args: [event] });
      },
    },
  };
}

describe("Tauri 桥接域", () => {
  it("扫描面覆盖到桥接域本身", () => {
    const paths = Object.keys(PACKAGE_SOURCE_FILES);
    expect(paths.length).toBeGreaterThan(0);
    expect(
      paths.some((path) => path.endsWith("/platform/tauri-invoke.ts")),
    ).toBe(true);
  });

  it("包内代码不出现 Tauri 运行时的模块名", () => {
    const hits = tauriModuleMentions();
    expect(hits.map((hit) => `${hit.path}: ${hit.line.trim()}`)).toEqual([]);
  });

  it("剥离注释的判据对代码命中、对注释不命中", () => {
    // 正例：真写进代码的动态导入与静态导入都必须被抓到
    expect(
      stripComments('await import("@tauri-apps/api/core")').includes(
        TAURI_MODULE,
      ),
    ).toBe(true);
    expect(
      stripComments('import { invoke } from "@tauri-apps/api/core";').includes(
        TAURI_MODULE,
      ),
    ).toBe(true);
    // 反例：仅出现在注释里不算违规
    expect(
      stripComments('// 不写 "@tauri-apps/api/core"\nconst a = 1;').includes(
        TAURI_MODULE,
      ),
    ).toBe(false);
    expect(
      stripComments('/* 不写 "@tauri-apps/api/core" */\nconst a = 1;').includes(
        TAURI_MODULE,
      ),
    ).toBe(false);
  });

  it("未装配桥时 fail-closed，且错误可类型化识别", async () => {
    // 本用例必须排在任何 installTauriBridge 之前（describe 内顺序执行，vitest 默认串行）
    await expect(defaultInvoke("host_platform")).rejects.toBeInstanceOf(
      TauriBridgeError,
    );
    await expect(defaultListen("changed", () => {})).rejects.toBeInstanceOf(
      TauriBridgeError,
    );
  });

  it("装配后转调桥，参数与返回值原样透传", async () => {
    const { bridge, calls } = spyBridge();
    installTauriBridge(bridge);
    await expect(
      defaultInvoke<string>("save_write", { slot: "1" }),
    ).resolves.toEqual({ echoed: "save_write" });
    expect(calls[0]).toEqual({
      kind: "invoke",
      args: ["save_write", { slot: "1" }],
    });

    let fired = 0;
    const unlisten = await defaultListen("changed", () => {
      fired += 1;
    });
    expect(fired).toBe(1);
    unlisten();
    expect(calls.map((call) => call.kind)).toEqual([
      "invoke",
      "listen",
      "unlisten",
    ]);
  });
});
