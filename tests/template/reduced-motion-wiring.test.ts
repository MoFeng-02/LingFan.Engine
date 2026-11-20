/**
 * 减弱动效「跟随系统」三态接线判据：两宿主合成点 + 组合根测量/收尾。
 *
 * 为什么是源码互锁而不是单元测试：合成点把玩家偏好与系统媒体查询经
 * `resolveReducedMotion` 合成有效值，组合根负责测量（matchMedia）与订阅收尾。
 * 一旦回退成 `preferences.reducedMotion ?? false`，undefined 会塌缩成 false 跳过
 * 系统层——设置面板「跟随系统」默认项就成了活控件死语义（无障碍刚需失效）。
 * 这里守装配形状：合成用纯函数 + 系统读面、组合根造查询并 dispose。
 * 用 `?raw` 读文本而不碰 fs：`tests/template` 属前端域，禁 Node 导入。
 */
import { describe, expect, it } from "vitest";
import templateEffects from "../../template/v1/__PROJECT__/src/host/effects.ts?raw";
import templateBoot from "../../template/v1/__PROJECT__/src/host/boot.ts?raw";
import playgroundFrame from "../../apps/playground/src/host/stage/frame/app-frame.ts?raw";
import playgroundLifecycle from "../../apps/playground/src/host/session/wiring/app-lifecycle.ts?raw";

describe("合成点：玩家显式 > 系统 > 内建关（禁塌缩 false 跳过系统层）", () => {
  it("template effects.ts 用 resolveReducedMotion 合成 player + system 读面", () => {
    expect(templateEffects).toContain("resolveReducedMotion");
    expect(templateEffects).toContain("readSystemReducedMotion");
    expect(templateEffects).toContain("player: preferences.reducedMotion");
    expect(templateEffects).toContain("system: readSystemReducedMotion?.()");
    expect(templateEffects).not.toContain("reducedMotion ?? false");
  });

  it("playground app-frame.ts 用 resolveReducedMotion 合成 player + system 读面", () => {
    expect(playgroundFrame).toContain("resolveReducedMotion");
    expect(playgroundFrame).toContain("readSystemReducedMotion");
    expect(playgroundFrame).toContain("player: preferences.reducedMotion");
    expect(playgroundFrame).toContain("system: readSystemReducedMotion?.()");
    expect(playgroundFrame).not.toContain("reducedMotion ?? false");
  });
});

describe("组合根：测量系统层 + 注入读面 + 收尾拆除", () => {
  it("template boot.ts 造查询、注入 matches 读面、dispose 收尾", () => {
    expect(templateBoot).toContain("createReducedMotionQuery()");
    expect(templateBoot).toContain(
      "readSystemReducedMotion: () => reducedMotionQuery.matches()",
    );
    expect(templateBoot).toContain("reducedMotionQuery.dispose()");
  });

  it("playground app-lifecycle.ts 造查询、注入 matches 读面、teardown 拆除", () => {
    expect(playgroundLifecycle).toContain("createReducedMotionQuery()");
    expect(playgroundLifecycle).toContain(
      "readSystemReducedMotion: () => reducedMotionQuery.matches()",
    );
    expect(playgroundLifecycle).toContain("reducedMotionQuery.dispose()");
  });
});
