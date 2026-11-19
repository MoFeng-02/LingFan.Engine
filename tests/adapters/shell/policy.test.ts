/**
 * 方向与全屏落壳策略：去重状态机 + 尽力而为语义。
 *
 * 策略只管「取值变了才落壳」与「平台不配合不算错误」；优先级本身（玩家显式 > 工程默认 > auto）
 * 由 core 的 resolveOrientationMode 裁定，这里经策略验证它确实被消费。端口与应用器全注入，
 * 不碰真实窗口/平台，纯内存可测。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrientationMode, OrientationPort } from "@lingfan-engine/core";
import {
  createFullscreenPolicy,
  createOrientationPolicy,
  type FullscreenApplier,
} from "@lingfan-engine/adapters";

/** 冲刷微任务：策略里的 port.apply().then 诊断回调要等一拍才落 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 方向端口替身：记录每次落壳的取值，按给定结果回应（生效/未生效/拒绝） */
function makeOrientationPort(result: boolean | Error): {
  port: OrientationPort;
  calls: OrientationMode[];
} {
  const calls: OrientationMode[] = [];
  const port: OrientationPort = {
    apply(mode) {
      calls.push(mode);
      return result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(result);
    },
  };
  return { port, calls };
}

describe("createOrientationPolicy", () => {
  let info: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    info.mockRestore();
    error.mockRestore();
  });

  it("玩家显式偏好优先于工程默认", async () => {
    const { port, calls } = makeOrientationPort(true);
    const apply = createOrientationPolicy({
      orientationPort: port,
      preference: () => "portrait",
      manifestDefault: () => "landscape",
    });
    apply();
    await flush();
    expect(calls).toEqual(["portrait"]);
  });

  it("未设偏好时跟随工程默认", async () => {
    const { port, calls } = makeOrientationPort(true);
    const apply = createOrientationPolicy({
      orientationPort: port,
      preference: () => undefined,
      manifestDefault: () => "landscape",
    });
    apply();
    await flush();
    expect(calls).toEqual(["landscape"]);
  });

  it("偏好与工程默认都缺省时落 auto", async () => {
    const { port, calls } = makeOrientationPort(true);
    const apply = createOrientationPolicy({
      orientationPort: port,
      preference: () => undefined,
      manifestDefault: () => undefined,
    });
    apply();
    await flush();
    expect(calls).toEqual(["auto"]);
  });

  it("同值去重：方向没变就不重复落壳（其他偏好变化不触发）", async () => {
    const { port, calls } = makeOrientationPort(true);
    const apply = createOrientationPolicy({
      orientationPort: port,
      preference: () => "portrait",
      manifestDefault: () => undefined,
    });
    apply();
    apply();
    apply();
    await flush();
    expect(calls).toEqual(["portrait"]);
  });

  it("偏好变到不同方向才再次落壳", async () => {
    const { port, calls } = makeOrientationPort(true);
    let pref: OrientationMode | undefined = "portrait";
    const apply = createOrientationPolicy({
      orientationPort: port,
      preference: () => pref,
      manifestDefault: () => undefined,
    });
    apply();
    pref = "landscape";
    apply();
    await flush();
    expect(calls).toEqual(["portrait", "landscape"]);
  });

  it("平台未生效只记诊断，不抛错（尽力而为）", async () => {
    const { port } = makeOrientationPort(false);
    const apply = createOrientationPolicy({
      orientationPort: port,
      preference: () => "portrait",
      manifestDefault: () => undefined,
    });
    expect(() => apply()).not.toThrow();
    await flush();
    expect(info).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("端口拒绝也只记诊断，不抛错", async () => {
    const { port } = makeOrientationPort(new Error("平台不支持"));
    const apply = createOrientationPolicy({
      orientationPort: port,
      preference: () => "landscape",
      manifestDefault: () => undefined,
    });
    expect(() => apply()).not.toThrow();
    await flush();
    expect(error).toHaveBeenCalledTimes(1);
    expect(info).not.toHaveBeenCalled();
  });
});

describe("createFullscreenPolicy", () => {
  /** 全屏应用器替身：记录每次落窗的开关 */
  function makeApplier(): { applier: FullscreenApplier; calls: boolean[] } {
    const calls: boolean[] = [];
    const applier: FullscreenApplier = {
      apply(on) {
        calls.push(on);
        return Promise.resolve();
      },
    };
    return { applier, calls };
  }

  it("initial 取构造时的偏好（未设置 = 窗口化）", () => {
    const { applier } = makeApplier();
    const on = createFullscreenPolicy({
      applier,
      preference: () => true,
    });
    expect(on.initial).toBe(true);
    const off = createFullscreenPolicy({
      applier,
      preference: () => undefined,
    });
    expect(off.initial).toBe(false);
  });

  it("启动恢复后同值不重复落窗", () => {
    const { applier, calls } = makeApplier();
    const policy = createFullscreenPolicy({
      applier,
      preference: () => true,
    });
    // 启动期由组合根直接 apply(initial)，策略自身的 apply 对同值不动
    policy.apply();
    policy.apply();
    expect(calls).toEqual([]);
  });

  it("偏好翻转才落窗", () => {
    const { applier, calls } = makeApplier();
    let pref = false;
    const policy = createFullscreenPolicy({
      applier,
      preference: () => pref,
    });
    expect(policy.initial).toBe(false);
    pref = true;
    policy.apply();
    pref = true;
    policy.apply(); // 同值不再落
    pref = false;
    policy.apply();
    expect(calls).toEqual([true, false]);
  });
});
