/**
 * 字速接线（template 对话层）：偏好滑杆 → 正在打字的那一句即时变速。
 *
 * 判据对着「滑杆是不是死控件」写：偏好层改了字速，对话层的打字机必须跟着变，
 * 而不是等下一句才生效。观测手段是打字机的可见字符数——`tick(1)` 按当前字速
 * 推进一秒，纯文本下可见长度就等于这一秒推进的字符数，字速变没变一目了然。
 *
 * 三级链的归属（偏好 > 故事 > 兜底）由 `resolveTextSpeed` 判，这里验的是接线：
 * 偏好变化经 `onChange` 到达打字机、`textSpeedSource` 决定滑杆改不改得动当前句。
 * DOM 用最小替身（与 tests/template 其余前端测试同口径），不引 jsdom。
 */
import { describe, expect, it } from "vitest";
import { PlayerPreferences } from "@lingfan-engine/core";
import {
  createDialogueView,
  type DialogueEngine,
} from "../../template/v1/__PROJECT__/src/host/dialogue-view";
import type { StageDom } from "../../template/v1/__PROJECT__/src/host/stage-dom";

/** 最小 DOM 替身：setDialogText 只写 text.innerHTML 与字体样式 */
function makeDom(): StageDom {
  const text = {
    innerHTML: "",
    style: {
      fontFamily: "",
      removeProperty(): void {},
    },
  };
  return { text } as unknown as StageDom;
}

/** 引擎替身：setDialogText 只读 dialogFont（缺省无字体），不推进状态 */
function makeEngine(): DialogueEngine {
  return {
    get: () => undefined,
    choose: () => {},
    input: () => {},
  } as unknown as DialogueEngine;
}

/** 一句足够长的纯文本：tick(1) 推进的字符数不会触顶，字速可直接读出 */
const LONG_TEXT = "a".repeat(200);

describe("字速接线 · 滑杆即时生效", () => {
  it("缺省归属：偏好字速赢，滑杆改动立刻作用到正在打字的句子", () => {
    const preferences = new PlayerPreferences();
    const dialogue = createDialogueView({
      dom: makeDom(),
      engine: makeEngine(),
      preferences,
    });
    dialogue.setDialogText(LONG_TEXT, undefined);
    const typewriter = dialogue.readTypewriter();
    expect(typewriter).not.toBeNull();

    // 默认偏好字速 30：第一秒推进 30 个可见字符
    typewriter!.tick(1);
    expect(typewriter!.visible.length).toBe(30);

    // 滑杆拨到 60：onChange 即时改当前句字速，下一秒推进 60（30 + 60 = 90）
    preferences.setTextSpeed(60);
    typewriter!.tick(1);
    expect(typewriter!.visible.length).toBe(90);
    dialogue.dispose();
  });

  it("显式 story 归属：锁作者字速，滑杆只改偏好不动当前句", () => {
    const preferences = new PlayerPreferences();
    preferences.setTextSpeedSource("story");
    const dialogue = createDialogueView({
      dom: makeDom(),
      engine: makeEngine(),
      preferences,
    });
    // 故事声明字速 10
    dialogue.setDialogText(LONG_TEXT, { speed: 10 });
    const typewriter = dialogue.readTypewriter();
    typewriter!.tick(1);
    expect(typewriter!.visible.length).toBe(10);

    // 滑杆拨到 60：归属是 story，当前句仍按作者字速 10 推进（10 + 10 = 20）
    preferences.setTextSpeed(60);
    typewriter!.tick(1);
    expect(typewriter!.visible.length).toBe(20);
    dialogue.dispose();
  });

  it("显式 player 归属：即便故事声明了字速，滑杆仍赢", () => {
    const preferences = new PlayerPreferences();
    preferences.setTextSpeedSource("player");
    const dialogue = createDialogueView({
      dom: makeDom(),
      engine: makeEngine(),
      preferences,
    });
    dialogue.setDialogText(LONG_TEXT, { speed: 10 });
    const typewriter = dialogue.readTypewriter();
    // player 归属：偏好默认 30 赢过故事 10
    typewriter!.tick(1);
    expect(typewriter!.visible.length).toBe(30);
    dialogue.dispose();
  });
});

describe("字速接线 · 向后兼容与拆除", () => {
  it("不接偏好：保持旧行为（故事字速优先，兜底次之）", () => {
    const dialogue = createDialogueView({
      dom: makeDom(),
      engine: makeEngine(),
      defaultCps: 25,
    });
    // 故事声明 10 → 用 10
    dialogue.setDialogText(LONG_TEXT, { speed: 10 });
    dialogue.readTypewriter()!.tick(1);
    expect(dialogue.readTypewriter()!.visible.length).toBe(10);
    // 无故事字速 → 兜底 25
    dialogue.setDialogText(LONG_TEXT, undefined);
    dialogue.readTypewriter()!.tick(1);
    expect(dialogue.readTypewriter()!.visible.length).toBe(25);
    dialogue.dispose();
  });

  it("dispose 退订：拆除后滑杆不再驱动已放手的打字机", () => {
    const preferences = new PlayerPreferences();
    const dialogue = createDialogueView({
      dom: makeDom(),
      engine: makeEngine(),
      preferences,
    });
    dialogue.setDialogText(LONG_TEXT, undefined);
    const typewriter = dialogue.readTypewriter();
    typewriter!.tick(1);
    expect(typewriter!.visible.length).toBe(30);

    dialogue.dispose();
    // 拆除后改偏好：打字机不再被 onChange 驱动，仍按原字速 30 推进
    preferences.setTextSpeed(60);
    typewriter!.tick(1);
    expect(typewriter!.visible.length).toBe(60);
  });
});
