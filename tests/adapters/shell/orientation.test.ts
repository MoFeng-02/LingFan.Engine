/**
 * 08 §八.2 屏幕方向端口适配器测试：invoke 契约替身注入，不依赖 Tauri 运行时
 * （Rust 侧模式解析与原生落点在 cargo 测——shell.rs；Kotlin 字符串契约由 bridge_check 互锁）。
 */
import { describe, expect, it } from "vitest";
import {
  createNoopOrientationPort,
  createTauriOrientationPort,
  type TauriInvoke,
} from "@lingfan/adapters";

function fakeInvoke(result: unknown | Error): {
  invoke: TauriInvoke;
  calls: Array<{ command: string; args?: Record<string, unknown> }>;
} {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const invoke: TauriInvoke = async (command, args) => {
    calls.push({ command, args });
    if (result instanceof Error) throw result;
    return result as never;
  };
  return { invoke, calls };
}

describe("08 §八.2 createTauriOrientationPort（invoke 契约替身）", () => {
  it("apply 透传 set_orientation 与 mode 参数键；已应用原样返回", async () => {
    const { invoke, calls } = fakeInvoke(true);
    const port = createTauriOrientationPort(invoke);
    await expect(port.apply("landscape")).resolves.toBe(true);
    expect(calls).toEqual([
      { command: "set_orientation", args: { mode: "landscape" } },
    ]);
  });

  it("平台未应用（false）如实透传：不谎报成功，也不算错误", async () => {
    const { invoke } = fakeInvoke(false);
    const port = createTauriOrientationPort(invoke);
    await expect(port.apply("portrait")).resolves.toBe(false);
  });

  it("invoke 失败向上传播（诊断归组合根）", async () => {
    const { invoke } = fakeInvoke(new Error("bad-mode"));
    const port = createTauriOrientationPort(invoke);
    await expect(port.apply("auto")).rejects.toThrow("bad-mode");
  });
});

describe("08 §八.2 createNoopOrientationPort（无壳形态）", () => {
  it("恒未应用且不抛错（浏览器宿主无方向概念）", async () => {
    const port = createNoopOrientationPort();
    await expect(port.apply("auto")).resolves.toBe(false);
    await expect(port.apply("landscape")).resolves.toBe(false);
  });
});
