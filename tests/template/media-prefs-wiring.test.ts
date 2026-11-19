/**
 * 媒体偏好的宿主接线：桌面壳偏好走 Rust、小程序视频乘偏好。
 *
 * 判的是「接线有没有接上」，不是端口自身行为（那在 tests/adapters/preferences 与
 * tests/ui/video 已测）：
 * - 桌面壳：组合根把 `createTauriPreferencesPort` 注入 `ports.preferences`，偏好落
 *   app_data 而不是 WebView 的 localStorage（清缓存会带走它）。这里用行为断言——
 *   真调 `createNativePorts()`，桌面壳标记在就拿到 preferences 端口，不在就回落。
 * - 小程序：`createVideoRenderer` 收到 `preferences`，视频音量与音频同口径乘偏好。
 *   这一条是纯接线，用源文本防腐（与 i18n-scaffold 同口径）。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  createNativePorts,
  isTauriHosted,
} from "../../template/v1/__PROJECT__/src/host/native-ports";
import nativePortsSource from "../../template/v1/__PROJECT__/src/host/native-ports.ts?raw";
import skeletonMain from "../../template/v1/__PROJECT__/src/main.ts?raw";
import bootSource from "../../template/v1/__PROJECT__/src/host/boot.ts?raw";
import mpHost from "../../template/v1/overlays/miniprogram/src/mp/host.ts?raw";

/** node 环境本无 window；测试期临时装一个桌面壳标记，用完摘掉 */
const g = globalThis as unknown as { window?: Record<string, unknown> };
afterEach(() => {
  delete g.window;
});

describe("桌面壳偏好端口注入（不回落 localStorage）", () => {
  it("非桌面壳：createNativePorts 返回 undefined，偏好走 Web 缺省", () => {
    g.window = {};
    expect(isTauriHosted()).toBe(false);
    expect(createNativePorts()).toBeUndefined();
  });

  it("桌面壳：注入 preferences 端口（load/save 齐备），不是空覆盖", () => {
    g.window = { __TAURI_INTERNALS__: {} };
    expect(isTauriHosted()).toBe(true);
    const ports = createNativePorts();
    expect(ports).toBeDefined();
    expect(typeof ports?.preferences?.load).toBe("function");
    expect(typeof ports?.preferences?.save).toBe("function");
    // 存档端口同批注入（偏好与存档都走 Rust，缺一个就是接线漏了）
    expect(ports?.saves).toBeDefined();
  });

  it("注入的是 Tauri 偏好端口（invoke preferences_read/write），不是 web storage", () => {
    expect(nativePortsSource).toContain("createTauriPreferencesPort");
    expect(nativePortsSource).toContain(
      "preferences: createTauriPreferencesPort(invoke)",
    );
  });

  it("组合根把原生端口交给 bootHost，boot 用覆盖口建偏好层", () => {
    expect(skeletonMain).toContain("createNativePorts()");
    expect(bootSource).toContain(
      "options.ports?.preferences ?? createWebStoragePreferencesPort()",
    );
  });
});

describe("小程序视频乘玩家偏好（与音频同口径）", () => {
  it("createVideoRenderer 收到 preferences", () => {
    // 取 createVideoRenderer( 到其后第一个闭合 options 块，确认 preferences 在其中
    const at = mpHost.indexOf("createVideoRenderer(");
    expect(at).toBeGreaterThanOrEqual(0);
    const block = mpHost.slice(at, at + 400);
    expect(block).toContain("preferences");
  });
});
