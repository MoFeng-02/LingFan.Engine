/**
 * 视频端口的呈现容器（组合根注入）：舞台整体缩放后，视频层必须跟着舞台走。
 *
 * 端口原先恒把 `<video>` 挂到 `document.body` 并按视口铺满（`position: fixed; inset: 0`）——
 * 舞台一旦被适配装配缩放着放进窗口，视频层就成了唯一不跟的那一层。这里钉住三件事：
 * 给了容器就挂进去并按容器定位、没给容器仍是铺满视口的既有行为、容器晚到也能改挂。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebVideoPort } from "@lingfan/adapters";

/** 假 `<video>`：只留端口真会碰到的字段与方法 */
interface FakeVideo {
  style: Record<string, string>;
  crossOrigin: string;
  src: string;
  loop: boolean;
  volume: number;
  error: null;
  currentTime: number;
  onended: (() => void) | null;
  parentElement: FakeContainer | null;
  addEventListener(): void;
  removeAttribute(name: string): void;
  remove(): void;
  pause(): void;
  play(): Promise<void>;
}

/** 假容器：`appendChild` 语义与 DOM 一致（已在别处时先摘下来） */
interface FakeContainer {
  children: FakeVideo[];
  appendChild(child: FakeVideo): FakeVideo;
}

function fakeContainer(): FakeContainer {
  const container: FakeContainer = {
    children: [],
    appendChild(child: FakeVideo): FakeVideo {
      const previous = child.parentElement;
      if (previous !== null) {
        previous.children = previous.children.filter((item) => item !== child);
      }
      child.parentElement = container;
      container.children.push(child);
      return child;
    },
  };
  return container;
}

function fakeVideo(): FakeVideo {
  const video: FakeVideo = {
    style: {},
    crossOrigin: "",
    src: "",
    loop: false,
    volume: 1,
    error: null,
    currentTime: 0,
    onended: null,
    parentElement: null,
    addEventListener(): void {
      // 端口只挂 error 监听；测试里不派发
    },
    removeAttribute(): void {
      video.src = "";
    },
    remove(): void {
      const parent = video.parentElement;
      if (parent !== null) {
        parent.children = parent.children.filter((item) => item !== video);
      }
      video.parentElement = null;
    },
    pause(): void {
      // 无播放态可停
    },
    play(): Promise<void> {
      return Promise.resolve();
    },
  };
  return video;
}

const body = fakeContainer();

beforeEach(() => {
  body.children = [];
  vi.stubGlobal("document", {
    createElement: (): FakeVideo => fakeVideo(),
    body,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const playOnce = { volume: 1, loop: false };

/** 端口只要求「一个能当容器的元素」；替身补不出 HTMLElement 的几百个成员，故此处断言类型 */
function asContainer(container: FakeContainer): HTMLElement {
  return container as unknown as HTMLElement;
}

describe("视频端口呈现容器", () => {
  it("注入了容器：挂进容器并按容器定位（随舞台缩放）", () => {
    const stage = fakeContainer();
    const port = createWebVideoPort({
      readContainer: () => asContainer(stage),
    });
    port.play("lfstream://stories/demo.mp4", playOnce);
    expect(stage.children).toHaveLength(1);
    expect(body.children).toHaveLength(0);
    expect(stage.children[0]?.style.position).toBe("absolute");
    expect(stage.children[0]?.style.cssText).toContain("width:100%");
  });

  it("未注入容器：仍是铺满视口的既有行为（挂 body 且 fixed）", () => {
    const port = createWebVideoPort({});
    port.play("lfstream://stories/demo.mp4", playOnce);
    expect(body.children).toHaveLength(1);
    expect(body.children[0]?.style.position).toBe("fixed");
  });

  it("容器返回 null（舞台根还没挂载）：先按既有行为，容器到齐后改挂", () => {
    let stage: FakeContainer | null = null;
    const port = createWebVideoPort({
      readContainer: () => (stage === null ? null : asContainer(stage)),
    });
    port.play("lfstream://stories/demo.mp4", playOnce);
    const attached = body.children[0];
    expect(attached).toBeDefined();
    stage = fakeContainer();
    port.play("lfstream://stories/demo.mp4", playOnce);
    expect(stage.children).toHaveLength(1);
    expect(body.children).toHaveLength(0);
    // 同一个元素改挂：不是又造了一个播放器（旧的那个会继续出声）
    expect(stage.children[0]).toBe(attached);
    expect(stage.children[0]?.style.position).toBe("absolute");
  });

  it("释放：元素从容器摘除，不再留在舞台里", () => {
    const stage = fakeContainer();
    const port = createWebVideoPort({
      readContainer: () => asContainer(stage),
    });
    port.play("lfstream://stories/demo.mp4", playOnce);
    port.dispose();
    expect(stage.children).toHaveLength(0);
  });
});
