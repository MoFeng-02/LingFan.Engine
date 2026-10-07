/**
 * 布局偏好：持久化 / 夹取 / 降级。
 * 拟态旅程：拖宽→刷新→宽度还在；存储被改坏→回落默认而不是白屏。
 */
import { describe, expect, it } from "vitest";
import type { KeyValueStorage } from "@lingfan/editor";
import {
  clampLayout,
  createLayoutStore,
  defaultLayout,
  LAYOUT_STORAGE_KEY,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  parseLayout,
  serializeLayout,
} from "../../apps/editor/src/layout";

/** 内存替身（可注入抛错，模拟隐私模式 / 配额满） */
function memStore(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("布局 · 默认与夹取", () => {
  it("默认值落在声明的区间内", () => {
    const d = defaultLayout();
    expect(d.leftWidth).toBeGreaterThanOrEqual(MIN_SIDEBAR_WIDTH);
    expect(d.leftWidth).toBeLessThanOrEqual(MAX_SIDEBAR_WIDTH);
    expect(d.sidebar).toBe("resources");
  });

  it("越界宽度夹取到边界（拖拽可越界，渲染不可越界）", () => {
    expect(clampLayout({ ...defaultLayout(), leftWidth: 10 }).leftWidth).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampLayout({ ...defaultLayout(), leftWidth: 9999 }).leftWidth).toBe(MAX_SIDEBAR_WIDTH);
  });

  it("非有限值 / 非法枚举回落默认（存储被外部改坏不炸）", () => {
    const bad = { ...defaultLayout(), leftWidth: Number.NaN, sidebar: "nope" as never };
    const fixed = clampLayout(bad);
    expect(fixed.leftWidth).toBe(defaultLayout().leftWidth);
    expect(fixed.sidebar).toBe("resources");
  });
});

describe("布局 · 持久化往返", () => {
  it("往返深等（存什么读回什么）", () => {
    const state = { ...defaultLayout(), leftWidth: 300, sidebar: "search" as const, rightCollapsed: true };
    expect(parseLayout(serializeLayout(state))).toEqual(state);
  });

  it("读回即夹取（防止存了越界值把布局撑坏）", () => {
    const raw = JSON.stringify({ version: 1, leftWidth: 5000 });
    expect(parseLayout(raw).leftWidth).toBe(MAX_SIDEBAR_WIDTH);
  });

  it("版本不符 / 坏 JSON / null ⇒ 降级为默认（fail-soft 不抛）", () => {
    expect(parseLayout(null)).toEqual(defaultLayout());
    expect(parseLayout("")).toEqual(defaultLayout());
    expect(parseLayout("{ not json")).toEqual(defaultLayout());
    expect(parseLayout(JSON.stringify({ version: 2, leftWidth: 300 }))).toEqual(defaultLayout());
    expect(parseLayout(JSON.stringify([1, 2, 3]))).toEqual(defaultLayout());
  });

  it("往返保留未知键的兼容：老版本存了别的字段也不影响已知键", () => {
    const raw = JSON.stringify({ version: 1, leftWidth: 280, futureFlag: true });
    const parsed = parseLayout(raw);
    expect(parsed.leftWidth).toBe(280);
  });
});

describe("布局 · 存储注入（先例同源：零 I/O + 静默降级）", () => {
  it("无存储（浏览器禁站点数据）⇒ 恒默认布局，功能不受影响", () => {
    const store = createLayoutStore(undefined);
    expect(store.load()).toEqual(defaultLayout());
    expect(() => store.save({ ...defaultLayout(), leftWidth: 400 })).not.toThrow();
  });

  it("存储读抛错 ⇒ 回落默认；写抛错 ⇒ 静默", () => {
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    const store = createLayoutStore(throwing);
    expect(store.load()).toEqual(defaultLayout());
    expect(() => store.save(defaultLayout())).not.toThrow();
  });

  it("拟态旅程：改宽度 → 存 → 新 store 读回（等同刷新页面后布局保留）", () => {
    const storage = memStore();
    const first = createLayoutStore(storage);
    first.save({ ...defaultLayout(), leftWidth: 420, rightWidth: 260, sidebar: "recent" });
    // 同一存储的新会话
    const second = createLayoutStore(storage);
    const loaded = second.load();
    expect(loaded.leftWidth).toBe(420);
    expect(loaded.rightWidth).toBe(260);
    expect(loaded.sidebar).toBe("recent");
    // 键名与工程无关（布局属应用不属工程）：前缀后**没有** story.id 段
    expect(storage.map.has(LAYOUT_STORAGE_KEY)).toBe(true);
    expect(LAYOUT_STORAGE_KEY).not.toContain("colgroups");
    expect(LAYOUT_STORAGE_KEY.startsWith("lingfan-editor-layout")).toBe(true);
  });
});
