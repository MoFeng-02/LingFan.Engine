/**
 * **音频端口的通道级暂停**（`pause` / `resume`）。
 *
 * 为什么暂停要单列一态：`stop` 是「这一段结束了」——作废在途物化、复位音量、清掉 URL 记录；
 * `pause` 是「这段还没结束，先别出声」——元素与播放位置原地留住。用 `stop` 顶替 `pause`
 * 会让恢复变成从头重播（位置丢、音量重置、解码重来），长 BGM 上一耳朵就听得出。
 *
 * 这组守六件事：
 * 1. `pause` 只关声：元素暂停，位置与音量原样，URL 记录不动（同一 URL 再 `play`
 *    仍走无缝更新而非重新起播）；
 * 2. `resume` 就地续播：不新建元素、不重设 `src`、不重置音量（它不走起播路径）；
 * 3. 未处于播放态的通道 `pause` 是空操作：不建元素、不抛错，之后照常起播；
 * 4. 重复 `pause` / 重复 `resume` 幂等：第二次不再多触发一次播放调用；
 * 5. 暂停中 `stop` 仍是完整停止语义（音量复位、URL 记录清空），不会被 `pause` 弱化成暂停；
 * 6. `stop` 之后再 `resume` 不复活：停止结束的是那一段，恢复不该把它重新点起来。
 *
 * 断言打的是「端口真的对元素做了什么」（元素属性与播放调用次数），不是源码字符串。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebAudioPort } from "@lingfan-engine/adapters";

interface FakeAudio {
  src: string;
  loop: boolean;
  volume: number;
  currentTime: number;
  preload: string;
  paused: boolean;
  playCount: number;
  removed: boolean;
  listeners: Map<string, () => void>;
  addEventListener(type: string, handler: () => void): void;
  removeAttribute(name: string): void;
  pause(): void;
  play(): Promise<void>;
}

function fakeAudio(): FakeAudio {
  const element: FakeAudio = {
    src: "",
    loop: false,
    volume: 1,
    currentTime: 0,
    preload: "",
    paused: false,
    playCount: 0,
    removed: false,
    listeners: new Map(),
    addEventListener(type, handler): void {
      element.listeners.set(type, handler);
    },
    removeAttribute(): void {
      element.src = "";
      element.removed = true;
    },
    pause(): void {
      element.paused = true;
    },
    play(): Promise<void> {
      element.paused = false;
      element.playCount += 1;
      return Promise.resolve();
    },
  };
  return element;
}

const created: FakeAudio[] = [];

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal("Audio", function FakeAudioCtor() {
    const element = fakeAudio();
    created.push(element);
    return element;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const options = {
  volume: 0.5,
  loop: true,
  position: 0,
  fadeMs: 0,
  restart: false,
};

/**
 * 起播样例 URL。无 `blobSource` 时物化只是一拍微任务——每个用例在 `play` 后
 * `await Promise.resolve()` 一次，元素 `src` 才落地。
 */
const themeUrl = "http://x/theme.mp3";

describe("音频端口 · pause 只关声，这一段不结束", () => {
  it("pause 后元素暂停，播放位置与音量原样保留", async () => {
    const port = createWebAudioPort();
    port.play("bgm", themeUrl, options);
    await Promise.resolve();
    created[0]!.currentTime = 12;

    port.pause("bgm");

    expect(created).toHaveLength(1);
    expect(created[0]?.paused).toBe(true);
    expect(created[0]?.src).toBe(themeUrl);
    // 暂停不碰音量：它是「先别出声」，音量归下次起播/淡入管
    expect(created[0]?.volume).toBe(0.5);
    expect(port.position("bgm")).toBe(12);
    expect(created[0]?.playCount).toBe(1);
    port.dispose();
  });

  it("pause 不动 URL 记录：同一 URL 再 play 仍是无缝更新", async () => {
    const port = createWebAudioPort();
    port.play("bgm", themeUrl, options);
    await Promise.resolve();

    port.pause("bgm");
    port.play("bgm", themeUrl, { ...options, volume: 0.2 });
    await Promise.resolve();

    // 若 pause 动过 URL 记录（如 stop 那样清空），这一拍会重设 src 并重新起播
    expect(created).toHaveLength(1);
    expect(created[0]?.src).toBe(themeUrl);
    expect(created[0]?.playCount).toBe(1);
    expect(created[0]?.volume).toBe(0.2);
    port.dispose();
  });
});

describe("音频端口 · resume 就地续播", () => {
  it("resume 续播原资源，不重新起播：音量与位置都不重置", async () => {
    const port = createWebAudioPort();
    port.play("bgm", themeUrl, options);
    await Promise.resolve();
    // 用一次同 URL 更新把音量调低：续播若走起播路径，音量会被 options.volume 覆盖回 0.5
    port.play("bgm", themeUrl, { ...options, volume: 0.2 });
    await Promise.resolve();
    created[0]!.currentTime = 7;

    port.pause("bgm");
    port.resume("bgm");
    await Promise.resolve();

    expect(created).toHaveLength(1);
    expect(created[0]?.paused).toBe(false);
    expect(created[0]?.src).toBe(themeUrl);
    expect(created[0]?.volume).toBe(0.2);
    expect(port.position("bgm")).toBe(7);
    // 整段只多了一次续播调用（起播路径还会再设一遍音量，并可能淡入）
    expect(created[0]?.playCount).toBe(2);
    port.dispose();
  });
});

describe("音频端口 · 未处于播放态时空操作", () => {
  it("未起播的通道 pause 不建元素、不抛错", () => {
    const port = createWebAudioPort();

    expect(() => port.pause("ambient")).not.toThrow();

    expect(created).toHaveLength(0);
    expect(port.position("ambient")).toBe(0);
    // 空操作不污染后续：照样能起播
    port.play("ambient", themeUrl, options);
    expect(created).toHaveLength(1);
    expect(created[0]?.src).toBe("");
    port.dispose();
  });

  it("se 通道不参与通道级暂停，音效元素不受影响", async () => {
    const port = createWebAudioPort();
    port.play("se", themeUrl, options);
    await Promise.resolve();
    expect(created).toHaveLength(1);
    expect(created[0]?.paused).toBe(false);

    port.pause("se");

    // 音效是一次性发声：通道级暂停不该掐掉它（要停得走 stop）
    expect(created[0]?.paused).toBe(false);
    port.stop("se");
    expect(created[0]?.paused).toBe(true);
    port.dispose();
  });
});

describe("音频端口 · 重复调用的幂等", () => {
  it("重复 pause 幂等：不新建元素、不额外触发播放", async () => {
    const port = createWebAudioPort();
    port.play("bgm", themeUrl, options);
    await Promise.resolve();

    port.pause("bgm");
    port.pause("bgm");
    port.pause("bgm");

    expect(created).toHaveLength(1);
    expect(created[0]?.paused).toBe(true);
    expect(created[0]?.playCount).toBe(1);
    expect(created[0]?.src).toBe(themeUrl);
    port.dispose();
  });

  it("重复 resume 幂等：第二次不会再触发一次播放", async () => {
    const port = createWebAudioPort();
    port.play("bgm", themeUrl, options);
    await Promise.resolve();

    port.pause("bgm");
    port.resume("bgm");
    await Promise.resolve();
    port.resume("bgm");
    await Promise.resolve();

    expect(created).toHaveLength(1);
    expect(created[0]?.paused).toBe(false);
    expect(created[0]?.playCount).toBe(2);
    port.dispose();
  });
});

describe("音频端口 · 暂停中的停止", () => {
  it("暂停中 stop 仍是完整停止语义：音量复位、URL 记录清空", async () => {
    const port = createWebAudioPort();
    port.play("voice", themeUrl, options);
    await Promise.resolve();
    created[0]!.currentTime = 4;

    port.pause("voice");
    port.stop("voice");

    expect(created[0]?.paused).toBe(true);
    // pause 不动音量，stop 才复位——这条区别是「停止没有退化成暂停」的直接证据
    expect(created[0]?.volume).toBe(1);

    // URL 记录被清空 ⇒ 同一 URL 再 play 走重新起播路径（而不是无缝更新）
    port.play("voice", themeUrl, options);
    await Promise.resolve();
    expect(created).toHaveLength(1);
    expect(created[0]?.playCount).toBe(2);
    expect(created[0]?.volume).toBe(0.5);
    port.dispose();
  });
});

describe("音频端口 · 停止之后不再被恢复复活", () => {
  it("停止后 resume 不复活：元素仍暂停、不重新播放、位置不回放", async () => {
    const port = createWebAudioPort();
    port.play("bgm", themeUrl, options);
    await Promise.resolve();
    created[0]!.currentTime = 6;

    port.pause("bgm");
    port.stop("bgm");
    port.resume("bgm");
    await Promise.resolve();

    expect(created).toHaveLength(1);
    // stop 结束的是这一段：元素留在暂停态，恢复不该把它重新点起来
    expect(created[0]?.paused).toBe(true);
    expect(created[0]?.playCount).toBe(1);
    expect(created[0]?.currentTime).toBe(6);
    port.dispose();
  });

  it("对照：中间没有 stop 的 pause → resume 照常续播，音量与位置都不重置", async () => {
    const port = createWebAudioPort();
    port.play("ambient", themeUrl, options);
    await Promise.resolve();
    created[0]!.currentTime = 9;

    port.pause("ambient");
    port.resume("ambient");
    await Promise.resolve();

    expect(created[0]?.paused).toBe(false);
    expect(created[0]?.playCount).toBe(2);
    expect(created[0]?.src).toBe(themeUrl);
    expect(created[0]?.volume).toBe(0.5);
    expect(created[0]?.currentTime).toBe(9);
    port.dispose();
  });

  it("停止后重新 play 再暂停，resume 照常续播：判据看的是 URL 记录，不是一次性开关", async () => {
    const port = createWebAudioPort();
    port.play("voice", themeUrl, options);
    await Promise.resolve();
    port.pause("voice");
    port.stop("voice");

    port.play("voice", themeUrl, options);
    await Promise.resolve();
    created[0]!.currentTime = 3;

    port.pause("voice");
    port.resume("voice");
    await Promise.resolve();

    expect(created).toHaveLength(1);
    expect(created[0]?.paused).toBe(false);
    expect(created[0]?.playCount).toBe(3);
    expect(created[0]?.currentTime).toBe(3);
    port.dispose();
  });
});
