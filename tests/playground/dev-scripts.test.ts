/**
 * 开发编排脚本的结构判据。
 *
 * 这两个脚本是链路上的第一环：参数在这里收口，章节 id 以环境变量的形式下发。
 * 判据钉住的是几件容易回归的事——本地可执行文件怎么找（走包清单再拼 bin/，
 * 不能从包主入口拼）、桌面脚本不得自己再起一个开发服务器（会抢同一个端口）、
 * 以及章节 id 必须以环境变量的形式下发（它是链路上唯一能穿过每一环的通道）。
 *
 * 断言落在源码文本上：脚本的职责是「怎么起另一个进程」，跑起来只能看见端口与
 * 页面，看不见「有没有多起一个进程」。
 */
import { describe, expect, it } from "vitest";
import devSource from "../../apps/playground/scripts/dev.mjs?raw";
import tauriDevSource from "../../apps/playground/scripts/tauri-dev.mjs?raw";
import rootManifest from "../../package.json?raw";

describe("开发编排脚本", () => {
  it("本地可执行文件走包清单再拼 bin 目录", () => {
    expect(devSource).toContain(
      'requireFromScript.resolve("vite/package.json")',
    );
    expect(devSource).toContain('join(dirname(manifest), "bin", "vite.js")');
    expect(tauriDevSource).toContain(
      'requireFromScript.resolve("@tauri-apps/cli/package.json")',
    );
    expect(tauriDevSource).toContain('join(dirname(manifest), "tauri.js")');
  });

  it("不从包主入口拼可执行文件路径", () => {
    for (const source of [devSource, tauriDevSource]) {
      expect(source).not.toContain('import.meta.resolve("vite")');
      expect(source).not.toContain('import.meta.resolve("@tauri-apps/cli")');
    }
  });

  it("章节 id 以环境变量的形式下发", () => {
    for (const source of [devSource, tauriDevSource]) {
      expect(source).toContain('const ENTRY_ENV = "VITE_LFEN_ENTRY"');
      expect(source).toContain("env[ENTRY_ENV] = result.entryId;");
    }
  });

  it("开发服务器脚本起开发服务器，桌面脚本不起开发服务器", () => {
    expect(devSource).toContain("resolveViteBin()");
    expect(tauriDevSource).not.toContain("resolveViteBin()");
    expect(tauriDevSource).toContain("resolveTauriBin()");
  });

  it("两个脚本都经子路径取参数解析，不自己实现解析", () => {
    for (const source of [devSource, tauriDevSource]) {
      expect(source).toContain(
        'await import("@lingfan-engine/stories-build/dev")',
      );
      expect(source).toContain("runDevCommand(");
    }
  });

  it("桌面脚本认得出自己的子命令，不把它当章节 id", () => {
    expect(tauriDevSource).toContain('argv[0] === "dev"');
    expect(tauriDevSource).toContain("TAURI_OTHER_SUBCOMMANDS");
    expect(tauriDevSource).toContain("isOtherSubcommand(");
  });

  it("仓根桌面命令经子包脚本，章节直达从仓根也成立", () => {
    const manifest = JSON.parse(rootManifest) as {
      scripts?: Record<string, string>;
    };
    expect(manifest.scripts?.tauri).toContain(
      "@lingfan-engine/playground tauri",
    );
    expect(manifest.scripts?.tauri).not.toContain("exec tauri");
  });
});
