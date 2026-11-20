/**
 * 玩家功能宿主接线回归（?raw 源锚）：键位新动作路由 + skip/auto 节奏循环 + persistent 端口。
 *
 * 模板输入面把 quickSave/quickLoad/skip/rollback/hideUI 走键位契约（改绑可配），
 * skip/auto 节奏经展示层单一循环装配；boot 注入 persistent 端口并水合。
 *
 * 证伪锚：新动作回退硬编码 / 删 persistent 水合，本册对应例转红。
 */
import { describe, expect, it } from "vitest";
import inputMapSource from "../../template/v1/__PROJECT__/src/host/input-map.ts?raw";
import bootSource from "../../template/v1/__PROJECT__/src/host/boot.ts?raw";
import keymapSource from "../../packages/ui/src/input/keymap.ts?raw";

describe("模板输入面：键位新动作走契约", () => {
  it("quickSave/quickLoad/skip/rollback/hideUI 经 keybinding 读面路由", () => {
    for (const action of [
      "quickSave",
      "quickLoad",
      "skip",
      "rollback",
      "hideUI",
    ]) {
      expect(inputMapSource).toContain(`keybinding("${action}")`);
      expect(inputMapSource).toContain(`DEFAULT_KEYMAP.${action}`);
    }
  });

  it("skip/auto 节奏经展示层单一循环（非各自 inline）", () => {
    expect(inputMapSource).toContain("createAutomatedAdvanceLoop");
    expect(inputMapSource).toContain("loop.startSkip()");
    expect(inputMapSource).toContain("loop.stopSkip()");
    expect(inputMapSource).toContain("loop.dispose()");
  });

  it("hideUI 经宿主回调（不直调平台 API）", () => {
    expect(inputMapSource).toContain("options.onHideUI?.()");
  });
});

describe("模板 boot：persistent 端口注入与水合", () => {
  it("引擎注入 persistentPort 并水合", () => {
    expect(bootSource).toContain("persistentPort:");
    expect(bootSource).toContain("engine.hydratePersistent()");
  });
});

describe("展示层键位匹配：组合键单一声明", () => {
  it("matchOne 拆 mod+key（组合键语法）", () => {
    expect(keymapSource).toContain('split("+")');
    expect(keymapSource).toContain("ctrlKey");
    expect(keymapSource).toContain("metaKey");
  });
});
