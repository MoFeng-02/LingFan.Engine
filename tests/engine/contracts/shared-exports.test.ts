/**
 * shared 判定函数经包根公共 API 可达（删 contracts→shared 回边后的出口面回归）。
 *
 * 回边清除前，shared 守卫靠 contracts/index.ts 的桶转发「捎带」到包根；删回边后
 * 改由包根 index.ts 直接 `export * from "./shared/index.ts"` 正向出口。本测试锁定
 * 全部 shared 符号仍从 @lingfan-engine/core 可达——出口面不因方向整改而缩水。
 */
import { describe, expect, it } from "vitest";
import * as core from "@lingfan-engine/core";

const GUARD_FUNCTIONS = [
  // audio
  "isAudioChannel",
  "isAudioInstanceId",
  "isAudioInstanceState",
  "isAudioInstanceTable",
  "audioInstanceIds",
  // errors
  "isEngineErrorCode",
  // guards
  "isElementType",
  "gameScopedKey",
  "isHostOs",
  "hostFormOf",
  "isOrientationMode",
  "isPlainObject",
  "isSceneType",
  "normalizeSceneType",
  "isReplayableColumn",
  "sceneTypeOf",
  // json
  "jsonUnsafeReason",
  "findJsonValueError",
  // mounts
  "isMountEntry",
  "isMountTable",
  "mountNames",
  // numbers
  "clamp01",
  // ordering
  "compareOrdinal",
  // scene-name
  "isSceneName",
  "normalizeSceneNames",
  // ui-name
  "isUiName",
  "normalizeUiNames",
] as const;

const PATTERNS = ["SCENE_NAME_PATTERN", "UI_NAME_PATTERN"] as const;

describe("shared 守卫包根可达（删回边后出口面不缩水）", () => {
  it("全部判定函数从 @lingfan-engine/core 可达", () => {
    const bag = core as unknown as Record<string, unknown>;
    const missing = GUARD_FUNCTIONS.filter((n) => typeof bag[n] !== "function");
    expect(missing).toEqual([]);
    expect(GUARD_FUNCTIONS.length).toBe(27);
  });

  it("两个命名模式常量从包根可达", () => {
    const bag = core as unknown as Record<string, unknown>;
    for (const name of PATTERNS) {
      expect(bag[name], name).toBeInstanceOf(RegExp);
    }
  });

  it("可达的是真守卫（行为抽样，非占位 stub）", () => {
    expect(core.isElementType("text")).toBe(true);
    expect(core.isElementType("not-an-element")).toBe(false);
    expect(core.isEngineErrorCode("unknown-op")).toBe(true);
    expect(core.isEngineErrorCode("no-such-code")).toBe(false);
    expect(core.isPlainObject({})).toBe(true);
    expect(core.isPlainObject(null)).toBe(false);
  });
});
