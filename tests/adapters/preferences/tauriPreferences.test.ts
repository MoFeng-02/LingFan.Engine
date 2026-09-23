/**
 * 08 §八.2 玩家偏好持久化（Tauri adapter）测试：invoke 契约替身注入，
 * 不依赖 Tauri 运行时（Rust 侧文件存取在 cargo 测——preferences.rs）。
 */
import { describe, expect, it } from "vitest";
import type { PlayerPrefsData } from "@lingfan/engine";
import {
  createTauriPreferencesPort,
  type TauriInvoke,
} from "@lingfan/adapters";
import { DEFAULT_PLAYER_PREFS } from "@lingfan/engine";

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

describe("08 §八.2 createTauriPreferencesPort（invoke 契约替身）", () => {
  it("load 透传 preferences_read；缺文件 null 原样保留", async () => {
    const { invoke, calls } = fakeInvoke(null);
    const port = createTauriPreferencesPort(invoke);
    await expect(port.load()).resolves.toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("preferences_read");
  });

  it("load 返回持久化载荷", async () => {
    const stored: PlayerPrefsData = {
      ...DEFAULT_PLAYER_PREFS,
      textSpeed: 60,
      muted: true,
    };
    const { invoke } = fakeInvoke(stored);
    const port = createTauriPreferencesPort(invoke);
    await expect(port.load()).resolves.toEqual(stored);
  });

  it("save 传 preferences_write + { prefs } 载荷", async () => {
    const { invoke, calls } = fakeInvoke(undefined);
    const port = createTauriPreferencesPort(invoke);
    await port.save(DEFAULT_PLAYER_PREFS);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("preferences_write");
    expect(calls[0]!.args).toEqual({ prefs: DEFAULT_PLAYER_PREFS });
  });

  it("invoke 拒绝向上传播（PlayerPreferences.hydrate fail-closed 依赖此信号）", async () => {
    const { invoke } = fakeInvoke(new Error("存储断路"));
    const port = createTauriPreferencesPort(invoke);
    await expect(port.load()).rejects.toThrow("存储断路");
  });
});
