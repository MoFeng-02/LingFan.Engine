/**
 * 媒体错误文案点名资源：缺资源/解码失败时必须报出**是哪个** URL，否则壳内只剩一句
 * 「无法解码或缺失」，无法判断是路径错、资源没打进包还是编码不支持。
 * 两个端口都在常驻元素上只挂一次 error 监听，文案取「最近一次 play 的逻辑 URL」——
 * 这里派发真实的 error 事件来锁住这条取值路径，而不是断言源码字符串。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWebAudioPort,
  createWebVideoPort,
} from "@lingfan-engine/adapters";

/** 假媒体元素：只留端口真会碰到的字段与方法，并记下挂上来的监听器 */
interface FakeMedia {
  style: Record<string, string>;
  crossOrigin: string;
  src: string;
  loop: boolean;
  volume: number;
  currentTime: number;
  preload: string;
  error: { code: number } | null;
  onended: (() => void) | null;
  parentElement: FakeBody | null;
  listeners: Map<string, () => void>;
  addEventListener(type: string, handler: () => void): void;
  removeAttribute(name: string): void;
  remove(): void;
  pause(): void;
  play(): Promise<void>;
}

interface FakeBody {
  children: FakeMedia[];
  appendChild(child: FakeMedia): FakeMedia;
}

function fakeBody(): FakeBody {
  const body: FakeBody = {
    children: [],
    appendChild(child: FakeMedia): FakeMedia {
      child.parentElement = body;
      body.children.push(child);
      return child;
    },
  };
  return body;
}

function fakeMedia(): FakeMedia {
  const media: FakeMedia = {
    style: {},
    crossOrigin: "",
    src: "",
    loop: false,
    volume: 1,
    currentTime: 0,
    preload: "",
    error: null,
    onended: null,
    parentElement: null,
    listeners: new Map(),
    addEventListener(type, handler): void {
      media.listeners.set(type, handler);
    },
    removeAttribute(): void {
      media.src = "";
    },
    remove(): void {
      media.parentElement = null;
    },
    pause(): void {
      // 无播放态可停
    },
    play(): Promise<void> {
      return Promise.resolve();
    },
  };
  return media;
}

const created: FakeMedia[] = [];
const body = fakeBody();

beforeEach(() => {
  created.length = 0;
  body.children = [];
  vi.stubGlobal("Audio", function FakeAudio() {
    const media = fakeMedia();
    created.push(media);
    return media;
  });
  vi.stubGlobal("document", {
    createElement: (): FakeMedia => {
      const media = fakeMedia();
      created.push(media);
      return media;
    },
    body,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const audioOptions = {
  volume: 1,
  loop: false,
  position: 0,
  fadeMs: 0,
  restart: false,
};

describe("音频端口的错误文案点名资源", () => {
  it("常驻通道：文案带本次 play 的 URL 与通道名", async () => {
    const messages: string[] = [];
    const port = createWebAudioPort({ onError: (m) => messages.push(m) });
    port.play(
      "bgm",
      "http://lfraw.localhost/raw/Audio%2Fbgm.mp3",
      audioOptions,
    );
    await Promise.resolve(); // 等物化/换源那一拍落地
    const media = created[0];
    expect(media).toBeDefined();
    media?.listeners.get("error")?.();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Audio%2Fbgm.mp3");
    expect(messages[0]).toContain("通道 bgm");
    port.dispose();
  });

  it("常驻通道复用：换源后报的是新资源，不残留上一轮的 URL", async () => {
    const messages: string[] = [];
    const port = createWebAudioPort({ onError: (m) => messages.push(m) });
    port.play(
      "bgm",
      "http://lfraw.localhost/raw/Audio%2Ffirst.mp3",
      audioOptions,
    );
    await Promise.resolve();
    port.play(
      "bgm",
      "http://lfraw.localhost/raw/Audio%2Fsecond.mp3",
      audioOptions,
    );
    await Promise.resolve();
    created[0]?.listeners.get("error")?.();
    expect(messages[0]).toContain("second.mp3");
    expect(messages[0]).not.toContain("first.mp3");
    port.dispose();
  });

  it("一次性音效：文案本就带 URL（回归锁）", async () => {
    const messages: string[] = [];
    const port = createWebAudioPort({ onError: (m) => messages.push(m) });
    port.play(
      "se",
      "http://lfraw.localhost/raw/Audio%2Fclick.mp3",
      audioOptions,
    );
    await Promise.resolve();
    created[0]?.listeners.get("error")?.();
    expect(messages[0]).toContain("Audio%2Fclick.mp3");
    port.dispose();
  });
});

describe("视频端口的错误文案点名资源", () => {
  it("解码失败：文案带当前视频 URL", () => {
    const messages: string[] = [];
    const port = createWebVideoPort({ onError: (m) => messages.push(m) });
    port.play("http://lfraw.localhost/raw/Video%2Fop.mp4", {
      volume: 1,
      loop: false,
    });
    const media = created[0];
    expect(media).toBeDefined();
    if (media === undefined) return;
    media.error = { code: 4 }; // MediaError 非空才算真解码失败
    media.listeners.get("error")?.();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Video%2Fop.mp4");
    port.dispose();
  });

  it("无 MediaError 的 error 事件不报（内建封面加载失败不算解码失败）", () => {
    const messages: string[] = [];
    const port = createWebVideoPort({ onError: (m) => messages.push(m) });
    port.play("http://lfraw.localhost/raw/Video%2Fop.mp4", {
      volume: 1,
      loop: false,
    });
    created[0]?.listeners.get("error")?.();
    expect(messages).toHaveLength(0);
    port.dispose();
  });
});
