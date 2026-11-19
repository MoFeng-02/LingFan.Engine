/**
 * Rust 命令错误消费（parseRustError / invokeRust / RustCommandError）的判据。
 *
 * 守的不变量：任何 invoke 拒绝形态过这一层后都是显式类型化错误——
 * 错误码在核心契约目录内、message 用户可读（绝不出现 "[object Object]"）、
 * 原始 detail 保留供程序分支（如回档检测的 save_count/high_water）。
 * 已知边界码按单一映射表转可读标签；未知形态落兜底码而不是静默吞掉。
 *
 * 五类覆盖：多方位（各码 / 各 detail 形态）、拟态旅程（invokeRust 成功与失败路径）、
 * 故意错误（非法形态 fail-closed）、不变量混沌（批量拒绝形态恒类型化）、
 * 边界（空串 / 空码 / 循环引用 / 映射键与目录互锁）。
 */
import { describe, expect, it } from "vitest";
import { ENGINE_ERROR_CODES, isEngineErrorCode } from "@lingfan-engine/core";
import {
  invokeRust,
  parseRustError,
  RUST_ERROR_MESSAGES,
  RustCommandError,
} from "../../../packages/adapters/src/platform/rust-error.ts";
import {
  TauriBridgeError,
  type TauriInvoke,
} from "../../../packages/adapters/src/platform/tauri-invoke.ts";

const CATALOG = new Set<string>(ENGINE_ERROR_CODES);
const FALLBACK = "rust-command-failed";

/** 包内全部源码：映射表单一声明的扫描面 */
const PACKAGE_SOURCES = import.meta.glob("../../../packages/*/src/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

describe("映射表与错误码目录互锁（rust-error-ts-consumed）", () => {
  it("映射表每个键都是目录里的边界码（编译期 satisfies 之外的运行时互锁）", () => {
    const keys = Object.keys(RUST_ERROR_MESSAGES);
    expect(keys.length).toBeGreaterThanOrEqual(25);
    for (const key of keys) {
      expect(isEngineErrorCode(key), `映射键 ${key} 不在错误码目录`).toBe(true);
      expect(
        RUST_ERROR_MESSAGES[key as keyof typeof RUST_ERROR_MESSAGES],
      ).toBeTruthy();
    }
  });

  it("映射表单一声明：其余包源码不得另立第二份", () => {
    expect(Object.keys(PACKAGE_SOURCES).length).toBeGreaterThan(30);
    const hits = Object.entries(PACKAGE_SOURCES)
      .filter(([, text]) => text.includes("const RUST_ERROR_MESSAGES"))
      .map(([path]) => path);
    expect(hits).toEqual([
      "../../../packages/adapters/src/platform/rust-error.ts",
    ]);
  });

  it("兜底码在目录里", () => {
    expect(CATALOG.has(FALLBACK)).toBe(true);
  });
});

describe("parseRustError · 已知边界码（多方位）", () => {
  it("字符串 detail：标签 + 原文拼接，code/detail 保留", () => {
    const err = parseRustError({ code: "io", detail: "磁盘已满" });
    expect(err).toBeInstanceOf(RustCommandError);
    expect(err.code).toBe("io");
    expect(err.message).toBe("文件读写失败：磁盘已满");
    expect(err.detail).toBe("磁盘已满");
    expect(err.name).toBe("RustCommandError");
  });

  it("对象 detail（回档检测）：save_count/high_water 原样保留供程序分支", () => {
    const detail = { save_count: 3, high_water: 9 };
    const err = parseRustError({ code: "rollback-detected", detail });
    expect(err.code).toBe("rollback-detected");
    expect(err.message).toContain("检测到回档");
    expect(err.message).toContain('"high_water":9');
    expect(err.detail).toEqual(detail);
  });

  it("对象 detail（超限）：size/limit 可读呈现", () => {
    const err = parseRustError({
      code: "too-large",
      detail: { size: 900, limit: 500 },
    });
    expect(err.code).toBe("too-large");
    expect(err.message).toContain("资源超出大小上限");
    expect(err.message).toContain("900");
    expect(err.message).toContain("500");
  });

  it("单元变体（无 detail）：只有标签，不拼空冒号", () => {
    const err = parseRustError({ code: "missing-key" });
    expect(err.code).toBe("missing-key");
    expect(err.message).toBe("资源密钥缺失");
  });

  it("全部已知码逐一映射：code 原样、message 以标签开头", () => {
    for (const [code, label] of Object.entries(RUST_ERROR_MESSAGES)) {
      const err = parseRustError({ code, detail: "x" });
      expect(err.code, `${code} 应保留原码`).toBe(code);
      expect(err.message.startsWith(label), `${code} 文案应以标签开头`).toBe(
        true,
      );
    }
  });
});

describe("parseRustError · 非法与未知形态（故意错误 fail-closed，fail-closed-readable）", () => {
  it("未知 code：落兜底码，message 含原码与详情（不静默吞）", () => {
    const err = parseRustError({ code: "brand-new-code", detail: "详情" });
    expect(err.code).toBe(FALLBACK);
    expect(err.message).toContain("brand-new-code");
    expect(err.message).toContain("详情");
    expect(err.detail).toBe("详情");
  });

  it("字符串拒绝（脚手架壳形态）：原样可读，落兜底码", () => {
    const err = parseRustError("非法槽位名: ../etc");
    expect(err.code).toBe(FALLBACK);
    expect(err.message).toBe("非法槽位名: ../etc");
  });

  it("Error 实例：保留 message（既有替身测试的子串断言兼容）", () => {
    const err = parseRustError(new Error("bad-mode"));
    expect(err.code).toBe(FALLBACK);
    expect(err.message).toBe("bad-mode");
  });

  it("无 message 的 Error：退到 name，不产出空文案", () => {
    const err = parseRustError(new Error(""));
    expect(err.message).toBe("Error");
  });

  it("对象但无 code / code 非字符串：兜底 + JSON 文本化", () => {
    const noCode = parseRustError({ reason: "x" });
    expect(noCode.code).toBe(FALLBACK);
    expect(noCode.message).toContain('"reason":"x"');
    const numericCode = parseRustError({ code: 42, detail: "d" });
    expect(numericCode.code).toBe(FALLBACK);
    expect(numericCode.message).not.toContain("[object Object]");
  });

  it("null / undefined / 数字 / 空串：兜底且 message 非空", () => {
    for (const shape of [null, undefined, 42, ""]) {
      const err = parseRustError(shape);
      expect(err.code).toBe(FALLBACK);
      expect(err.message.length).toBeGreaterThan(0);
      expect(err.message).not.toContain("[object Object]");
    }
  });

  it("循环引用 detail：不抛异常、不产出 [object Object]", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const err = parseRustError({ code: "io", detail: cyclic });
    expect(err.code).toBe("io");
    expect(err.message).toContain("文件读写失败");
    expect(err.message).not.toContain("[object Object]");
    expect(err.detail).toBe(cyclic);
  });

  it("幂等：已类型化错误原样返回（同一实例，不二次包裹）", () => {
    const first = parseRustError({ code: "crypto", detail: "bad tag" });
    expect(parseRustError(first)).toBe(first);
  });
});

describe("parseRustError · 不变量混沌（批量形态恒类型化）", () => {
  it("任意拒绝形态 → RustCommandError + 目录内码 + 非空可读文案", () => {
    const shapes: unknown[] = [
      { code: "io", detail: "x" },
      { code: "rollback-detected", detail: { save_count: 1, high_water: 2 } },
      { code: "unknown-slot" },
      { code: "wat" },
      { code: "" },
      { code: null },
      { detail: "only-detail" },
      "plain string",
      "",
      new Error("boom"),
      new TypeError("type boom"),
      0,
      -1,
      Number.NaN,
      true,
      false,
      null,
      undefined,
      [],
      [1, 2],
      { nested: { deep: { value: 1 } } },
      Symbol("s"),
      10n,
    ];
    for (const shape of shapes) {
      const err = parseRustError(shape);
      expect(err).toBeInstanceOf(RustCommandError);
      expect(CATALOG.has(err.code), `码 ${err.code} 应在目录内`).toBe(true);
      expect(err.message.length).toBeGreaterThan(0);
      expect(err.message).not.toContain("[object Object]");
    }
  });
});

describe("invokeRust · 拟态旅程（成功透传 / 失败类型化 / 桥错误区分）", () => {
  it("成功：结果与参数原样透传", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const invoke: TauriInvoke = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      calls.push({ command, args });
      return { ok: true } as T;
    };
    const result = await invokeRust<{ ok: boolean }>(invoke, "save_list", {
      slot: "slot_1",
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([{ command: "save_list", args: { slot: "slot_1" } }]);
  });

  it("失败：边界负载抛 RustCommandError（调用方可按 code 分支）", async () => {
    const invoke: TauriInvoke = async () => {
      throw {
        code: "rollback-detected",
        detail: { save_count: 2, high_water: 7 },
      };
    };
    await expect(
      invokeRust(invoke, "save_read", { slot: "s" }),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof RustCommandError &&
        e.code === "rollback-detected" &&
        (e.detail as { high_water: number }).high_water === 7,
    );
  });

  it("桥未装配：TauriBridgeError 原样透传（配置问题与命令失败区分）", async () => {
    const bridgeError = new TauriBridgeError("桥未装配");
    const invoke: TauriInvoke = async () => {
      throw bridgeError;
    };
    await expect(invokeRust(invoke, "save_list")).rejects.toBe(bridgeError);
  });

  it("字符串拒绝（脚手架壳）：类型化后 message 仍可读", async () => {
    const invoke: TauriInvoke = async () => {
      throw "非法槽位名: a/b";
    };
    await expect(
      invokeRust(invoke, "save_write", { slot: "a/b" }),
    ).rejects.toThrow("非法槽位名: a/b");
  });
});
