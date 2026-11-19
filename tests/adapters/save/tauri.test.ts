/**
 * Tauri 存档端口的编组与错误旅程：成功路径的命令名/参数键/snake→camel 映射
 * 必须原样（合法输入结果不变）；失败路径四个方法一律抛类型化错误
 * （错误码在目录内、文案可读、detail 保留），绝不把边界负载裸抛给上层。
 *
 * 替身 invoke 按契约注入（不依赖 Tauri 运行时）；跨边界字符串契约的另一半
 * 由 Rust 侧 bridge_check 互锁，本文件只测 TS 侧编组行为。
 */
import { describe, expect, it } from "vitest";
import { isEngineErrorCode } from "@lingfan-engine/core";
import { createTauriSavePort } from "../../../packages/adapters/src/save/tauri.ts";
import { RustCommandError } from "../../../packages/adapters/src/platform/rust-error.ts";
import type { TauriInvoke } from "../../../packages/adapters/src/platform/tauri-invoke.ts";

/** 记录调用的替身：按命令名返回预置结果或抛预置错误 */
function recordingInvoke(
  handler: (command: string, args?: Record<string, unknown>) => unknown,
): { invoke: TauriInvoke; calls: Array<[string, Record<string, unknown>?]> } {
  const calls: Array<[string, Record<string, unknown>?]> = [];
  const invoke: TauriInvoke = async <T>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> => {
    calls.push([command, args]);
    return handler(command, args) as T;
  };
  return { invoke, calls };
}

describe("Tauri 存档端口 · 成功编组（合法输入结果不变）", () => {
  it("write：save_write + slot/payload/mode 三键原样", async () => {
    const { invoke, calls } = recordingInvoke(() => undefined);
    const port = createTauriSavePort(invoke);
    await port.write("slot_1", '{"v":1}', "machine-bound");
    expect(calls).toEqual([
      [
        "save_write",
        { slot: "slot_1", payload: '{"v":1}', mode: "machine-bound" },
      ],
    ]);
  });

  it("read：save_read 返回的字符串原样透传", async () => {
    const { invoke } = recordingInvoke(() => '{"history":[]}');
    const port = createTauriSavePort(invoke);
    await expect(port.read("slot_2")).resolves.toBe('{"history":[]}');
  });

  it("remove：save_delete + slot 键", async () => {
    const { invoke, calls } = recordingInvoke(() => undefined);
    const port = createTauriSavePort(invoke);
    await port.remove("slot_3");
    expect(calls).toEqual([["save_delete", { slot: "slot_3" }]]);
  });

  it("list：snake_case 行映射成 camelCase 摘要（save_count→saveCount）", async () => {
    const rows = [
      {
        slot: "slot_1",
        save_count: 4,
        timestamp: 1700000000,
        mode: "machine-bound",
      },
      {
        slot: "slot_2",
        save_count: 1,
        timestamp: 1600000000,
        mode: "portable",
      },
    ];
    const { invoke, calls } = recordingInvoke(() => rows);
    const port = createTauriSavePort(invoke);
    await expect(port.list()).resolves.toEqual([
      {
        slot: "slot_1",
        saveCount: 4,
        timestamp: 1700000000,
        mode: "machine-bound",
      },
      { slot: "slot_2", saveCount: 1, timestamp: 1600000000, mode: "portable" },
    ]);
    expect(calls).toEqual([["save_list", undefined]]);
  });
});

describe("Tauri 存档端口 · 失败旅程（四方法一律类型化，fail-closed）", () => {
  const boundaryError = {
    code: "unknown-slot",
    detail: "slot_9 不存在",
  };

  it("read 缺档：RustCommandError + unknown-slot + 可读文案", async () => {
    const { invoke } = recordingInvoke(() => {
      throw boundaryError;
    });
    const port = createTauriSavePort(invoke);
    const err = await port.read("slot_9").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RustCommandError);
    const typed = err as RustCommandError;
    expect(typed.code).toBe("unknown-slot");
    expect(isEngineErrorCode(typed.code)).toBe(true);
    expect(typed.message).toContain("槽位不存在");
    expect(typed.message).not.toContain("[object Object]");
    expect(typed.detail).toEqual("slot_9 不存在");
  });

  it("write 回档检测：code 可分支，detail 的 high_water 保留", async () => {
    const { invoke } = recordingInvoke(() => {
      throw {
        code: "rollback-detected",
        detail: { save_count: 2, high_water: 11 },
      };
    });
    const port = createTauriSavePort(invoke);
    const err = (await port
      .write("slot_1", "{}", "machine-bound")
      .catch((e: unknown) => e)) as RustCommandError;
    expect(err).toBeInstanceOf(RustCommandError);
    expect(err.code).toBe("rollback-detected");
    expect(err.detail).toEqual({ save_count: 2, high_water: 11 });
  });

  it("remove / list 失败同样类型化（不裸抛边界对象）", async () => {
    const { invoke } = recordingInvoke(() => {
      throw { code: "io", detail: "permission denied" };
    });
    const port = createTauriSavePort(invoke);
    for (const action of [port.remove("slot_1"), port.list()]) {
      const err = (await action.catch((e: unknown) => e)) as RustCommandError;
      expect(err).toBeInstanceOf(RustCommandError);
      expect(err.code).toBe("io");
      expect(err.message).toContain("文件读写失败");
      expect(err.message).toContain("permission denied");
    }
  });

  it("脚手架壳的字符串拒绝：类型化后文案原样可读（明文壳错误不蒸发）", async () => {
    const { invoke } = recordingInvoke(() => {
      throw "非法槽位名: ../etc";
    });
    const port = createTauriSavePort(invoke);
    const err = (await port
      .write("../etc", "{}", "portable")
      .catch((e: unknown) => e)) as RustCommandError;
    expect(err).toBeInstanceOf(RustCommandError);
    expect(err.message).toBe("非法槽位名: ../etc");
    expect(isEngineErrorCode(err.code)).toBe(true);
  });

  it("非法槽位被拒后端口仍可用（状态原样：后续合法调用不受污染）", async () => {
    let reject = true;
    const { invoke } = recordingInvoke(() => {
      if (reject) {
        reject = false;
        throw { code: "invalid-slot", detail: "bad name" };
      }
      return '{"ok":true}';
    });
    const port = createTauriSavePort(invoke);
    await expect(port.read("../etc")).rejects.toBeInstanceOf(RustCommandError);
    await expect(port.read("slot_1")).resolves.toBe('{"ok":true}');
  });
});
