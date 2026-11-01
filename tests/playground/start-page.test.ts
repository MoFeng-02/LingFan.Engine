/**
 * 宿主入口页与对局内界面的分界：
 * 启动页、暂停菜单属宿主应用层（`src/pages/`），引擎不认识它们，UI 名扫描面也不收它们；
 * 进不进对局由宿主决定——组合根初始化不再自动启动引擎，注入的挂载面才让「舞台上的界面」成立。
 */
import { describe, expect, it } from "vitest";
import appEngineSource from "../../apps/playground/src/host/engine/app-engine.ts?raw";
import mainSource from "../../apps/playground/src/main.ts?raw";
import pausePageSource from "../../apps/playground/src/pages/pause/pause.vue?raw";
import pagesIndexSource from "../../apps/playground/src/pages/index.ts?raw";
import startPageSource from "../../apps/playground/src/pages/start/start.vue?raw";
import uiRegisterSource from "../../apps/playground/src/gen/ui_register.g.ts?raw";

/** 生成物里的 UI 表：键即 `src/ui/<名>/<名>` 的名字 */
function uiNamesOf(registerSource: string): readonly string[] {
  const body = registerSource.slice(registerSource.indexOf("export const uis"));
  const names: string[] = [];
  for (const match of body.matchAll(/"([^"]+)":/g)) names.push(match[1] ?? "");
  return names;
}

describe("宿主页面与挂载 UI 分界", () => {
  it("普通页面住在 src/pages/，不进 UI 名扫描面", () => {
    expect(startPageSource).toContain('class="start-page"');
    expect(pausePageSource).toContain('class="pause-page"');
    expect(pagesIndexSource).toContain(
      'export { default as StartPage } from "./start/start.vue";',
    );
    expect(pagesIndexSource).toContain(
      'export { default as PausePage } from "./pause/pause.vue";',
    );
    const names = uiNamesOf(uiRegisterSource);
    expect(names).toContain("hub");
    expect(names).not.toContain("start");
    expect(names).not.toContain("pause");
  });

  it("组合根初始化不再自动启动引擎，进对局由宿主显式触发", () => {
    const initEngineBody = appEngineSource.slice(
      appEngineSource.indexOf("function initEngine"),
      appEngineSource.indexOf("function enterGame"),
    );
    expect(initEngineBody).not.toContain(".start()");
    expect(appEngineSource).toContain(
      "function enterGame(columnId?: string): void {",
    );
    expect(appEngineSource).toContain(
      "function continueGame(slot: string): void {",
    );
    expect(appEngineSource).toContain(
      "return { initEngine, enterGame, continueGame, restart, unbind };",
    );
  });

  it("组合根把挂载表、UI 组件表与写入口交给宿主", () => {
    expect(mainSource).toContain("mounts: mountStore,");
    expect(mainSource).toContain("mountsTable: uis,");
    expect(mainSource).toContain("onMounts: (raw: unknown) => {");
    expect(mainSource).toContain("const mountStore = createMountStore();");
    expect(mainSource).toContain('import { uis } from "./gen/ui_register.g";');
  });
});
