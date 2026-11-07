/**
 * 包管理器识别与命令替换的判据测试。
 *
 * 为什么值得单独钉住：生成器是给别人用的工具，装依赖与打印后续步骤都随调用方
 * 的包管理器变。认错一次就是「照提示敲，报找不到命令」——这类错误看起来像
 * 官方指引写错了，比不打印提示更糟。
 */
import { describe, expect, it } from "vitest";
import {
  currentPackageManager,
  detectPackageManager,
  parsePackageManager,
} from "../../packages/create/src/shared/package-manager.ts";
import {
  fillManagerCommands,
  renderNextSteps,
} from "../../packages/create/src/cli/install.ts";
import { defaultCreateTexts } from "../../packages/create/src/shared/texts.ts";

describe("从 user-agent 认包管理器", () => {
  it.each([
    ["npm/11.2.0 node/v22.14.0 win32 x64 workspaces/false", "npm"],
    ["pnpm/12.18.0 npm/? node/v22.14.0 win32 x64", "pnpm"],
    ["yarn/4.6.0 npm/? node/v22.14.0 win32 x64", "yarn"],
    ["bun/1.2.0 npm/? node/v22.14.0 win32 x64", "bun"],
  ])("认出 %s", (agent, expected) => {
    expect(parsePackageManager(agent)).toBe(expected);
  });

  it("认不出时返回 undefined，而不是猜一个", () => {
    expect(parsePackageManager(undefined)).toBeUndefined();
    expect(parsePackageManager("")).toBeUndefined();
    expect(parsePackageManager("deno/2.0.0")).toBeUndefined();
  });
});

describe("可执行路径当退路", () => {
  it("从路径里取文件名，正反斜杠都认", () => {
    expect(parsePackageManager("C:/Users/x/AppData/Roaming/npm/pnpm.cjs")).toBe(
      "pnpm",
    );
    expect(parsePackageManager("/usr/local/bin/yarn.cjs")).toBe("yarn");
  });
});

describe("优先级", () => {
  it("user-agent 压过 execPath", () => {
    expect(
      detectPackageManager({
        userAgent: "pnpm/12.18.0",
        execPath: "/usr/local/bin/npm.cjs",
      }).id,
    ).toBe("pnpm");
  });

  it("没有 user-agent 时用 execPath", () => {
    expect(
      detectPackageManager({ execPath: "/usr/local/bin/yarn.cjs" }).id,
    ).toBe("yarn");
  });

  it("两样都没有时退回 npm——它的命令形式在另外三家下基本也能跑", () => {
    expect(detectPackageManager({}).id).toBe("npm");
  });

  it("真实进程环境里拿得到的也是四家之一", () => {
    expect(["npm", "pnpm", "yarn", "bun"]).toContain(
      currentPackageManager().id,
    );
  });
});

describe("命令写法", () => {
  it("pnpm 与 yarn 直接念脚本名，npm 与 bun 要 run", () => {
    expect(detectPackageManager({ userAgent: "pnpm/12" }).script).toBe("dev");
    expect(detectPackageManager({ userAgent: "yarn/4" }).script).toBe("dev");
    expect(detectPackageManager({ userAgent: "npm/11" }).script).toBe(
      "run dev",
    );
    expect(detectPackageManager({ userAgent: "bun/1" }).script).toBe("run dev");
  });
});

describe("把占位符换成实际命令", () => {
  it("npm 下给出 npm 的写法", () => {
    const npm = detectPackageManager({ userAgent: "npm/11.2.0" });
    expect(fillManagerCommands("<install> 然后 <dev>", npm)).toBe(
      "npm install 然后 npm run dev",
    );
  });

  it("pnpm 下给出 pnpm 的写法", () => {
    const pnpm = detectPackageManager({ userAgent: "pnpm/12.18.0" });
    expect(fillManagerCommands("<install> 然后 <dev>", pnpm)).toBe(
      "pnpm install 然后 pnpm dev",
    );
  });

  it("下一步提示里不再残留占位符，也不写死任何一家", () => {
    const yarn = detectPackageManager({ userAgent: "yarn/4.6.0" });
    const text = renderNextSteps("E:/tmp/my-story", yarn, defaultCreateTexts);
    expect(text).toContain("cd E:/tmp/my-story");
    expect(text).toContain("yarn install");
    expect(text).toContain("yarn dev");
    expect(text).not.toContain("<install>");
    expect(text).not.toContain("<dev>");
    expect(text).not.toContain("pnpm");
  });
});
