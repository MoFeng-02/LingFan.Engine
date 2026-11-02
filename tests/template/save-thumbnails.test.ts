/**
 * 存档缩略图与存档接线的判据。
 *
 * 三层，各自防一种回归：
 * 1. **纯函数层**（`stripHtml` / `drawTextOverlay`）：折行与「不带文本」这类
 *    只在画布上才看得见的规则，用记录调用的假 canvas 断言——真跑 canvas 在 CI 里
 *    没有实现，而规则本身是纯的。
 * 2. **合成层**（`captureSaveThumbnail`）：尺寸/质量来自配置而不是硬编码，
 *    且没有 2d 上下文时必须抛错（由调用方降级），不能静默返回空串。
 * 3. **接线层**（`wireSaveSlots`）：点「存」要把缩略图带上；缩略图合成失败时
 *    仍要存（不带图），不能让装饰挡住存盘。
 */

import { describe, expect, it, vi } from "vitest";
import type { StoryEngine } from "@lingfan-engine/core";
import {
  captureSaveThumbnail,
  drawTextOverlay,
  stripHtml,
  type SaveThumbnailInput,
} from "../../template/v1/__PROJECT__/src/host/thumbnails";
import { wireSaveSlots } from "../../template/v1/__PROJECT__/src/host/save-slots";
import type { StageDom } from "../../template/v1/__PROJECT__/src/host/stage-dom";

/** 记录所有绘制调用的假 2d 上下文 */
interface FakeContext {
  calls: string[];
  fillStyle: string;
  font: string;
  fillText: (text: string, x: number, y: number) => void;
  fillRect: (x: number, y: number, w: number, h: number) => void;
  createLinearGradient: () => {
    addColorStop: (offset: number, color: string) => void;
  };
  texts: { text: string; x: number; y: number }[];
  gradients: string[][];
}

function createFakeContext(): FakeContext {
  const texts: { text: string; x: number; y: number }[] = [];
  const gradients: string[][] = [];
  return {
    calls: [],
    fillStyle: "",
    font: "",
    texts,
    gradients,
    fillText(text, x, y) {
      texts.push({ text, x, y });
    },
    fillRect() {},
    createLinearGradient() {
      const stops: string[] = [];
      gradients.push(stops);
      return {
        addColorStop(_offset, color) {
          stops.push(color);
        },
      };
    },
  };
}

/** 装一个假 canvas 到全局 document 上；返回取得到的那份记录 */
function stubCanvas(context: FakeContext | null): {
  widths: number[];
  heights: number[];
  encoded: { type: string; quality?: number }[];
} {
  const widths: number[] = [];
  const heights: number[] = [];
  const encoded: { type: string; quality?: number }[] = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toDataURL: (type: string, quality?: number) => {
      encoded.push({ type, quality });
      return `data:${type};base64,STUB`;
    },
  };
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      expect(tag).toBe("canvas");
      return new Proxy(canvas, {
        set(target, key, value) {
          if (key === "width") widths.push(value as number);
          if (key === "height") heights.push(value as number);
          Reflect.set(target, key, value);
          return true;
        },
      });
    },
  });
  return { widths, heights, encoded };
}

function input(
  overrides: Partial<SaveThumbnailInput> = {},
): SaveThumbnailInput {
  return {
    width: 320,
    height: 180,
    quality: 0.7,
    showText: true,
    title: "灵泛引擎",
    speaker: "旁白",
    text: "你好，世界。",
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

describe("存档缩略图：纯函数层", () => {
  it("stripHtml 只剥标签，不动文本内容", () => {
    expect(stripHtml("<em>你好</em>，<b>世界</b>")).toBe("你好，世界");
    expect(stripHtml("没有标签")).toBe("没有标签");
  });

  it("**showText 为假时一条文字都不画**（只剩背景）", () => {
    const context = createFakeContext();
    drawTextOverlay(context as unknown as CanvasRenderingContext2D, {
      ...input(),
      showText: false,
    });
    expect(context.texts).toHaveLength(0);
  });

  it("标题、说话人、正文、时间戳都在卡上", () => {
    const context = createFakeContext();
    drawTextOverlay(context as unknown as CanvasRenderingContext2D, input());
    const joined = context.texts.map((item) => item.text).join("");
    expect(joined).toContain("灵泛引擎");
    expect(joined).toContain("旁白");
    expect(joined).toContain("你好，世界。");
    // 时间戳由 toLocaleString 渲染，只断言它确实画了第四组文字（比正文更靠下）
    const last = context.texts[context.texts.length - 1];
    expect(last.y).toBeGreaterThan(context.texts[0].y);
  });

  it("**正文超出宽度就折行**，不会画到卡外面", () => {
    const context = createFakeContext();
    const long = "很长的一句话".repeat(20);
    drawTextOverlay(context as unknown as CanvasRenderingContext2D, {
      ...input(),
      text: long,
    });
    const body = context.texts.slice(0, -1); // 去掉时间戳
    expect(body.length).toBeGreaterThan(10);
    // 每行起点回到左内边距，且纵向位置不越界
    const xs = [...new Set(body.map((item) => item.x))];
    expect(xs.length).toBeGreaterThan(1);
    for (const item of body) {
      expect(item.x).toBeGreaterThanOrEqual(0);
      expect(item.x).toBeLessThan(320);
      expect(item.y).toBeLessThan(180);
    }
  });
});

describe("存档缩略图：合成层", () => {
  it("尺寸与质量取自入参（配置），不写死", () => {
    const context = createFakeContext();
    const stub = stubCanvas(context);
    const dataUrl = captureSaveThumbnail(
      input({ width: 640, height: 360, quality: 0.42 }),
    );
    expect(stub.widths).toEqual([640]);
    expect(stub.heights).toEqual([360]);
    expect(stub.encoded).toEqual([{ type: "image/jpeg", quality: 0.42 }]);
    expect(dataUrl).toBe("data:image/jpeg;base64,STUB");
    // 背景渐变两档色停
    expect(context.gradients).toHaveLength(1);
    expect(context.gradients[0]).toHaveLength(2);
  });

  it("**没有 2d 上下文必须抛错**，不能静默返回空串", () => {
    stubCanvas(null);
    expect(() => captureSaveThumbnail(input())).toThrow(
      "canvas 2d 上下文不可用",
    );
  });
});

describe("存档接线：点「存」带缩略图", () => {
  interface FakeButton {
    handlers: (() => void)[];
    addEventListener: (type: string, handler: () => void) => void;
    fire: () => void;
  }

  function fakeButton(): FakeButton {
    const handlers: (() => void)[] = [];
    return {
      handlers,
      addEventListener(_type, handler) {
        handlers.push(handler);
      },
      fire() {
        for (const handler of handlers) handler();
      },
    };
  }

  interface SavedCall {
    slot: string;
    screenshot?: string;
  }

  function setup(saveSucceeds: boolean): {
    saveButton: FakeButton;
    loadButton: FakeButton;
    saved: SavedCall[];
    loaded: string[];
  } {
    const saved: SavedCall[] = [];
    const loaded: string[] = [];
    const saveButton = fakeButton();
    const loadButton = fakeButton();
    const dom = {
      slot: { value: "slot_2" },
      save: saveButton,
      load: loadButton,
    } as unknown as StageDom;
    const engine = {
      get(key: string): unknown {
        if (key === "__current_dialog_speaker") return "旁白";
        if (key === "__current_dialog_text") return "<em>你好</em>，世界。";
        return undefined;
      },
      save(slot: string, options?: { screenshot?: string }) {
        saved.push({ slot, screenshot: options?.screenshot });
      },
      load(slot: string) {
        loaded.push(slot);
      },
    } as unknown as StoryEngine;
    if (saveSucceeds) {
      stubCanvas(createFakeContext());
    } else {
      stubCanvas(null);
    }
    wireSaveSlots(dom, engine, {
      name: "测试工程",
      shell: { saves: { thumbnail: { width: 200, height: 120 } } },
    });
    return { saveButton, loadButton, saved, loaded };
  }

  it("**存盘带上当前对话合成的缩略图**，槽位取下拉当前值", () => {
    const { saveButton, saved } = setup(true);
    saveButton.fire();
    expect(saved).toHaveLength(1);
    expect(saved[0].slot).toBe("slot_2");
    expect(saved[0].screenshot).toBe("data:image/jpeg;base64,STUB");
  });

  it("**缩略图合成失败仍然存**（只是没有图）", () => {
    const { saveButton, saved } = setup(false);
    saveButton.fire();
    expect(saved).toHaveLength(1);
    expect(saved[0].slot).toBe("slot_2");
    expect(saved[0].screenshot).toBeUndefined();
  });

  it("读档只传槽位，不碰缩略图", () => {
    const { loadButton, loaded, saved } = setup(true);
    loadButton.fire();
    expect(loaded).toEqual(["slot_2"]);
    expect(saved).toHaveLength(0);
  });
});
