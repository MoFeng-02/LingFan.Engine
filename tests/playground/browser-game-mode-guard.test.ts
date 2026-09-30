/**
 * 浏览器游戏模式守卫锚点（`browser-game-mode-guard`）：
 * 交付形态只应是 Tauri 壳——封闭构建下浏览器既进不去应用（前端守卫），也取不到资源
 * （`publicDir` 不镜像）。本用例以真值表锁行为、以源级断言锁接线与两侧开关名互锁。
 */
import { describe, expect, it } from "vitest";
import viteConfigSource from "../../apps/playground/vite.config.ts?raw";
import mainSource from "../../apps/playground/src/main.ts?raw";
import guardSource from "../../apps/playground/src/browserGuard.ts?raw";
import templateViteSource from "../../template/v1/__PROJECT__/vite.config.ts?raw";
import {
  BROWSER_GAME_FLAG,
  browserBlockedMessage,
  browserPlayAllowed,
} from "../../apps/playground/src/browserGuard";

describe("判据真值表（fail-closed：只有 dev 与显式开关放行）", () => {
  it("dev 放行（开发模式便利）", () => {
    expect(browserPlayAllowed({ dev: true, browserGame: undefined })).toBe(true);
    expect(browserPlayAllowed({ dev: true, browserGame: "0" })).toBe(true);
  });

  it("显式开关放行（浏览器游戏模式 = 唯一例外口）", () => {
    expect(browserPlayAllowed({ dev: false, browserGame: "1" })).toBe(true);
  });

  it("其余一律封闭（含开关写错/留空/写成别的值——不猜、不静默降级）", () => {
    for (const browserGame of [undefined, "", "0", "true", "yes", " 1", "1 "]) {
      expect(browserPlayAllowed({ dev: false, browserGame })).toBe(false);
    }
  });
});

describe("组合根接线：无壳时先过守卫，再谈供端口", () => {
  it("守卫位于端口装配之前且以 useNative 为前提", () => {
    expect(mainSource).toContain("!useNative && !browserPlayAllowed()");
    const guardAt = mainSource.indexOf("!useNative && !browserPlayAllowed()");
    const portAt = mainSource.indexOf("createFetchProjectFilesPort(");
    expect(guardAt).toBeGreaterThan(-1);
    expect(portAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(portAt); // 先拒绝，后装配（否则白拒）
  });

  it("拒绝是可见且可操作的（写入 #app + 控制台），不是白屏/静默", () => {
    expect(mainSource).toContain("renderBrowserBlocked");
    const message = browserBlockedMessage();
    expect(message).toContain("此构建不允许在浏览器中运行");
    expect(message).toContain(BROWSER_GAME_FLAG); // 文案给出可操作开关（不是干巴巴一句拒绝）
    expect(message).toContain("pnpm dev"); // 开发调试的出口也要写清
  });

  it("开关名两侧互锁：vite.config 与守卫模块读同一个名（防漂移）", () => {
    expect(BROWSER_GAME_FLAG).toBe("VITE_LFEN_BROWSER_GAME");
    expect(guardSource).toContain(`"${BROWSER_GAME_FLAG}"`);
    expect(viteConfigSource).toContain(`process.env.${BROWSER_GAME_FLAG}`);
    // 守卫侧走 vite 注入的 import.meta.env（前缀 VITE_ 才注入），两处都不得写成裸 process.env
    expect(guardSource).toContain(`import.meta.env.${BROWSER_GAME_FLAG}`);
  });
});

describe("产物资源面：封闭构建不镜像资源根（直接 URL 也扒不到）", () => {
  it("publicDir 条件化：仅 dev（command === serve）与浏览器游戏模式镜像", () => {
    expect(viteConfigSource).toContain(
      'publicDir: command === "serve" || isBrowserGame ? "Resources" : false',
    );
    // 防回退为无条件镜像（那会把整个资源根裸拷进产物）
    expect(viteConfigSource).not.toContain('publicDir: "Resources",');
  });

  it("vite config 工厂必须读 command（serve/build 区分是镜像条件的一半）", () => {
    expect(viteConfigSource).toContain("defineConfig(({ command }) =>");
  });
});

describe("脚手架不受影响（有意：纯 Web 即浏览器游戏模式的交付正例）", () => {
  it("template/v1 保持无条件镜像，且不引入本守卫", () => {
    expect(templateViteSource).toContain('publicDir: "Resources"');
    expect(templateViteSource).not.toContain("VITE_LFEN_BROWSER_GAME");
  });
});
