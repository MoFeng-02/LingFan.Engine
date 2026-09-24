/**
 * 01 §四.3 I18N overlay 供给（Tauri adapter）测试：invoke 契约替身注入，
 * 不依赖 Tauri 运行时（两侧各测一半的边界在此——Rust 侧文件列举/解密在 cargo 测）。
 */
import { describe, expect, it } from "vitest";
import {
  createTauriI18nPort,
  type TauriInvoke,
  type TauriOverlayFile,
} from "@lingfan/adapters";

function fakeInvoke(files: TauriOverlayFile[] | Error): {
  invoke: TauriInvoke;
  calls: Array<{ command: string; args?: Record<string, unknown> }>;
} {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const invoke: TauriInvoke = async (command, args) => {
    calls.push({ command, args });
    if (files instanceof Error) throw files;
    return files as never;
  };
  return { invoke, calls };
}

describe("01 §四.3 createTauriI18nPort（invoke 契约替身）", () => {
  it("透传 lang 到 load_i18n_overlay 命令", async () => {
    const { invoke, calls } = fakeInvoke([]);
    const port = createTauriI18nPort(invoke);
    await port.loadOverlayFiles("en");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("load_i18n_overlay");
    expect(calls[0]!.args).toEqual({ lang: "en" });
  });

  it("Rust 负载映射为 I18nOverlayFile（entries 逐文件拷贝隔离）", async () => {
    const entries = { 你好: "Hello" };
    const { invoke } = fakeInvoke([{ path: "main.json", entries }]);
    const port = createTauriI18nPort(invoke);
    const files = await port.loadOverlayFiles("en");
    expect(files).toEqual([{ path: "main.json", entries }]);
    entries["你好"] = "mutated"; // 源对象变更不外泄
    expect(files[0]!.entries["你好"]).toBe("Hello");
  });

  it("invoke 拒绝向上传播（引擎 fail-closed 依赖此信号）", async () => {
    const { invoke } = fakeInvoke(new Error("资源根不可用"));
    const port = createTauriI18nPort(invoke);
    await expect(port.loadOverlayFiles("de")).rejects.toThrow("资源根不可用");
  });

  it("listLanguages 透传 list_i18n_languages 命令（老引擎 GetAvailableLanguages 对应物）", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke: TauriInvoke = async (command) => {
      calls.push({ command });
      return ["zh-CN", "en-US"] as never;
    };
    const port = createTauriI18nPort(invoke);
    const langs = (await port.listLanguages?.()) ?? [];
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("list_i18n_languages");
    expect(langs).toEqual(["zh-CN", "en-US"]);
  });
});
