/**
 * **音频端口的实例维度**（`playInstance` / `stopInstance` / `setVolumeInstance`）。
 *
 * 为什么实例不走四通道：四通道是叙事语义（这段是 BGM、这句是语音），实例是作者的
 * 编排单元（两段环境音交叉、三段音效各调各的）。用通道承载实例会立刻撞两堵墙——
 * 通道键只有四个，且偏好按通道分档，塞进去就没法给「同一个通道的第二个声音」单独调音量。
 *
 * 这组守五件事：
 * 1. 三个方法都是**可选**能力：不实现的端口照样是合法 `AudioPort`（小程序形态即如此），
 *    调用方用 `?.` 容错——缺能力不能变成卡死；
 * 2. 实例之间互不干扰：改 A 的音量不动 B，停 A 不哑 B；
 * 3. 同 id 重复起播 = 更新（不叠放），不同 id = 各自独立（可叠放）；
 * 4. `setVolumeInstance` **不重播**：不重设 `src`、不动播放位置——拖滑块时才敢用它；
 * 5. 停掉的实例不再回填在途解析结果（物化是异步的，迟到的那一拍必须作废）。
 *
 * 断言打的是「端口真的对元素做了什么」（元素属性与事件），不是源码字符串。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMiniprogramAudioPort,
  createWebAudioPort,
} from "@lingfan-engine/adapters";

interface FakeAudio {
  src: string;
  loop: boolean;
  volume: number;
  currentTime: number;
  preload: string;
  listeners: Map<string, () => void>;
  paused: boolean;
  removed: boolean;
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
    listeners: new Map(),
    paused: false,
    removed: false,
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

describe("音频端口 · 实例维度的能力面", () => {
  it("Web 端口实现三个实例方法", () => {
    const port = createWebAudioPort();
    expect(typeof port.playInstance).toBe("function");
    expect(typeof port.stopInstance).toBe("function");
    expect(typeof port.setVolumeInstance).toBe("function");
    port.dispose();
  });

  it("小程序端口不实现实例能力（缺能力是合法形态，不是违约）", () => {
    const port = createMiniprogramAudioPort(
      () =>
        ({
          src: "",
          volume: 1,
          loop: false,
          currentTime: 0,
          play(): void {},
          pause(): void {},
          stop(): void {},
          destroy(): void {},
          onEnded(): void {},
          onError(): void {},
        }) as never,
    );
    expect(port.playInstance).toBeUndefined();
    expect(port.stopInstance).toBeUndefined();
    expect(port.setVolumeInstance).toBeUndefined();
    // 四通道面照旧齐备——退化的只是实例维度，不是整个端口
    expect(typeof port.play).toBe("function");
    expect(typeof port.stop).toBe("function");
    expect(typeof port.position).toBe("function");
    port.dispose();
  });
});

describe("音频端口 · 实例之间互不干扰", () => {
  it("两个实例各自一个元素，能同时响", async () => {
    const port = createWebAudioPort();
    port.playInstance?.("rain", "http://x/rain.mp3", options);
    port.playInstance?.("crickets", "http://x/crickets.mp3", {
      ...options,
      volume: 0.2,
    });
    await Promise.resolve();
    const [rain, crickets] = created;
    expect(created).toHaveLength(2);
    expect(rain?.src).toBe("http://x/rain.mp3");
    expect(crickets?.src).toBe("http://x/crickets.mp3");
    expect(rain?.volume).toBe(0.5);
    expect(crickets?.volume).toBe(0.2);
    expect(rain?.paused).toBe(false);
    expect(crickets?.paused).toBe(false);
    port.dispose();
  });

  it("改一个实例的音量不动另一个", async () => {
    const port = createWebAudioPort();
    port.playInstance?.("rain", "http://x/rain.mp3", options);
    port.playInstance?.("crickets", "http://x/crickets.mp3", options);
    await Promise.resolve();
    port.setVolumeInstance?.("rain", 0.1);
    expect(created[0]?.volume).toBe(0.1);
    expect(created[1]?.volume).toBe(0.5);
    port.dispose();
  });

  it("停一个实例不哑另一个", async () => {
    const port = createWebAudioPort();
    port.playInstance?.("rain", "http://x/rain.mp3", options);
    port.playInstance?.("crickets", "http://x/crickets.mp3", options);
    await Promise.resolve();
    port.stopInstance?.("rain");
    expect(created[0]?.paused).toBe(true);
    expect(created[1]?.paused).toBe(false);
    port.dispose();
  });
});

describe("音频端口 · 同 id 与不同 id", () => {
  it("同 id 重复起播是更新：不新建元素、不重设 src", async () => {
    const port = createWebAudioPort();
    port.playInstance?.("rain", "http://x/rain.mp3", options);
    await Promise.resolve();
    const srcBefore = created[0]!.src;
    port.playInstance?.("rain", "http://x/rain.mp3", {
      ...options,
      volume: 0.9,
      // 位置由调用方给出：渲染层每次都会把自己认为的位置一起传下来，
      // 所以更新路径照它定位，不会自作主张回到 0。
      position: 7,
    });
    await Promise.resolve();
    expect(created).toHaveLength(1);
    expect(created[0]?.volume).toBe(0.9);
    expect(created[0]?.src).toBe(srcBefore); // 没有重新解码
    expect(created[0]?.currentTime).toBe(7);
    port.dispose();
  });

  it("同 id 更新时显式给新位置就按它定位", async () => {
    const port = createWebAudioPort();
    port.playInstance?.("rain", "http://x/rain.mp3", options);
    await Promise.resolve();
    created[0]!.currentTime = 3;
    port.playInstance?.("rain", "http://x/rain.mp3", {
      ...options,
      position: 20,
    });
    await Promise.resolve();
    expect(created).toHaveLength(1);
    expect(created[0]?.currentTime).toBe(20);
    port.dispose();
  });

  it("显式 restart 回到起点，但仍不新建元素", async () => {
    const port = createWebAudioPort();
    port.playInstance?.("rain", "http://x/rain.mp3", options);
    await Promise.resolve();
    created[0]!.currentTime = 7;
    port.playInstance?.("rain", "http://x/rain.mp3", {
      ...options,
      restart: true,
      position: 0,
    });
    await Promise.resolve();
    expect(created).toHaveLength(1);
    expect(created[0]?.currentTime).toBe(0);
    port.dispose();
  });

  it("换资源重设 src，元素复用", async () => {
    const port = createWebAudioPort();
    port.playInstance?.("rain", "http://x/a.mp3", options);
    await Promise.resolve();
    port.playInstance?.("rain", "http://x/b.mp3", options);
    await Promise.resolve();
    expect(created).toHaveLength(1);
    expect(created[0]?.src).toBe("http://x/b.mp3");
    port.dispose();
  });
});

describe("音频端口 · setVolumeInstance 不重播", () => {
  it("不重设 src、不动播放位置、不触发 play", async () => {
    const port = createWebAudioPort();
    port.playInstance?.("rain", "http://x/rain.mp3", options);
    await Promise.resolve();
    const element = created[0]!;
    element.currentTime = 12;
    const srcBefore = element.src;
    let playCount = 0;
    element.play = (): Promise<void> => {
      playCount += 1;
      return Promise.resolve();
    };

    port.setVolumeInstance?.("rain", 0.7);

    expect(element.src).toBe(srcBefore);
    expect(element.currentTime).toBe(12);
    expect(playCount).toBe(0);
    expect(element.volume).toBe(0.7);
    port.dispose();
  });

  it("越界音量按边界钳制（不整段静音，也不放大到破音）", async () => {
    const port = createWebAudioPort();
    port.playInstance?.("rain", "http://x/rain.mp3", options);
    await Promise.resolve();
    port.setVolumeInstance?.("rain", 9);
    expect(created[0]?.volume).toBe(1);
    port.setVolumeInstance?.("rain", -3);
    expect(created[0]?.volume).toBe(0);
    port.dispose();
  });

  it("给未起播的实例调音量是空操作，不凭空造元素", () => {
    const port = createWebAudioPort();
    port.setVolumeInstance?.("ghost", 0.5);
    expect(created).toHaveLength(0);
    port.dispose();
  });
});

describe("音频端口 · 停掉后不许回填", () => {
  it("停止发生在物化回填之前 ⇒ 迟到的那一拍不再设 src", async () => {
    const port = createWebAudioPort();
    port.playInstance?.("rain", "http://x/rain.mp3", options);
    // 尚未 await：resolveSource 的 then 还没跑
    port.stopInstance?.("rain");
    await Promise.resolve();
    expect(created[0]?.src ?? "").toBe("");
    port.dispose();
  });
});

describe("音频端口 · 淡出与清理", () => {
  it("stopInstance 带淡出走斜坡，走完才 pause", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
      setTimeout(() => cb(performance.now()), 16);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const port = createWebAudioPort();
    void port.playInstance?.("rain", "http://x/rain.mp3", options);
    return Promise.resolve()
      .then(() => {
        port.stopInstance?.("rain", 100);
        expect(created[0]?.paused).toBe(false); // 还在淡出
      })
      .finally(() => port.dispose());
  });

  it("dispose 断掉实例元素的 src（不留后台解码）", async () => {
    const port = createWebAudioPort();
    port.playInstance?.("rain", "http://x/rain.mp3", options);
    await Promise.resolve();
    port.dispose();
    expect(created[0]?.src).toBe("");
    expect(created[0]?.removed).toBe(true);
  });
});
