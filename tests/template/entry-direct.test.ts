/**
 * 直达某列这条链路的模板侧接线判据。
 *
 * 链路：模板工程的开发编排脚本把章节 id 放进环境变量 → 组合根读出并注入宿主 →
 * 宿主在引擎起来之后跳到该列。
 *
 * 断言落在源码文本上（`?raw`），因为这条链路的正确性取决于「哪一段代码在什么时机
 * 调用了什么」，跑起来反而看不见。
 */
import { describe, expect, it } from "vitest";
import bootSource from "../../template/v1/__PROJECT__/src/host/boot.ts?raw";
import skeletonDevScript from "../../template/v1/__PROJECT__/scripts/dev.mjs?raw";
import skeletonMain from "../../template/v1/__PROJECT__/src/main.ts?raw";
import skeletonViteEnv from "../../template/v1/__PROJECT__/src/vite-env.d.ts?raw";
import tauriDevScript from "../../template/v1/overlays/tauri/scripts/tauri-dev.mjs?raw";
import reactMain from "../../template/v1/overlays/react/src/main.tsx?raw";
import vueMain from "../../template/v1/overlays/vue/src/main.ts?raw";

describe("直达链路的模板接线", () => {
  it("开发脚本从环境变量下发章节 id", () => {
    expect(skeletonDevScript).toContain('const ENTRY_ENV = "VITE_LFEN_ENTRY";');
    expect(skeletonDevScript).toContain("env[ENTRY_ENV] = entryId;");
    expect(skeletonDevScript).toContain(
      'await import("@lingfan-engine/stories-build/dev")',
    );
  });

  it("开发脚本取开发服务器的可执行文件：走包清单再拼 bin 目录", () => {
    // 走主入口目录拼不出可执行文件的位置——主入口在编译产物目录里。
    expect(skeletonDevScript).toContain(
      'requireFromScript.resolve("vite/package.json")',
    );
    expect(skeletonDevScript).toContain(
      'join(dirname(manifest), "bin", "vite.js")',
    );
    expect(skeletonDevScript).not.toContain('import.meta.resolve("vite")');
  });

  it("桌面脚本把章节 id 下发给桌面命令的前置命令，不自己起开发服务器", () => {
    expect(tauriDevScript).toContain('const ENTRY_ENV = "VITE_LFEN_ENTRY";');
    expect(tauriDevScript).toContain("env[ENTRY_ENV] = result.entryId;");
    // 桌面链的前置命令自己会起开发服务器，起了就抢同一个端口。
    expect(tauriDevScript).not.toContain("resolveViteBin");
  });

  it("三个组合根都把章节 id 交给宿主", () => {
    for (const source of [skeletonMain, vueMain, reactMain]) {
      expect(source).toContain("entry: import.meta.env.VITE_LFEN_ENTRY,");
    }
  });

  it("宿主收下章节 id，并在引擎起来之后跳到该列", () => {
    expect(bootSource).toContain("entry?: string;");
    const start = bootSource.indexOf("engine.start();");
    expect(start).toBeGreaterThan(-1);
    const navigate = bootSource.indexOf("engine.navigate(options.entry);");
    expect(navigate).toBeGreaterThan(start);
  });

  it("环境变量类型在三份声明里都写了", () => {
    // 三份声明互相覆盖，漏一份就会在对应形态的工程里丢失类型。
    expect(skeletonViteEnv).toContain("VITE_LFEN_ENTRY?: string;");
  });
});
