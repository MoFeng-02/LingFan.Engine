/**
 * 宿主能力声明（`HostInfo.capabilities`）与能力比对纯函数。
 *
 * 能力是装配期的**数据声明**，不是运行时探测：core 据此静态比对组件所需与宿主所能，
 * 不碰 DOM、不探平台。比对是纯函数——同样的输入恒同样的输出，缺能力即列缺项（fail-closed）。
 * `capabilities` 是 `HostInfo` 的只增可选字段：缺省＝未声明，既有 `{os,form}` 消费方不受影响。
 */
import { describe, expect, it } from "vitest";
import {
  HOST_CAPABILITY_VALUES,
  missingHostCapabilities,
  resolveHost,
  type HostCapability,
  type HostInfo,
} from "@lingfan-engine/core";

describe("宿主能力词表（capabilities-pure-data）", () => {
  it("能力词表非空、无重复、形态合法", () => {
    expect(HOST_CAPABILITY_VALUES.length).toBeGreaterThan(0);
    expect(new Set(HOST_CAPABILITY_VALUES).size).toBe(
      HOST_CAPABILITY_VALUES.length,
    );
    for (const cap of HOST_CAPABILITY_VALUES) {
      expect(cap).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("词表覆盖三宿主装配用到的能力面", () => {
    for (const cap of ["video", "audio", "mount", "body", "storage", "i18n"]) {
      expect(HOST_CAPABILITY_VALUES).toContain(cap);
    }
  });
});

describe("能力比对纯函数（capabilities-pure-data）", () => {
  it("组件未声明所需 → 恒满足（合法输入结果不变）", () => {
    expect(missingHostCapabilities([], HOST_CAPABILITY_VALUES)).toEqual([]);
    expect(missingHostCapabilities([], undefined)).toEqual([]);
    expect(missingHostCapabilities([], [])).toEqual([]);
  });

  it("宿主未声明任何能力 → 组件声明的所需全部缺（fail-closed）", () => {
    const required: HostCapability[] = ["mount", "body"];
    expect(missingHostCapabilities(required, undefined)).toEqual([
      "mount",
      "body",
    ]);
    expect(missingHostCapabilities(required, [])).toEqual(["mount", "body"]);
  });

  it("宿主部分声明 → 只列缺项，保持所需顺序", () => {
    const required: HostCapability[] = ["video", "mount", "body", "i18n"];
    const available: HostCapability[] = ["video", "i18n"];
    expect(missingHostCapabilities(required, available)).toEqual([
      "mount",
      "body",
    ]);
  });

  it("宿主全量声明 → 无缺项", () => {
    expect(
      missingHostCapabilities(HOST_CAPABILITY_VALUES, HOST_CAPABILITY_VALUES),
    ).toEqual([]);
  });

  it("纯数据：同输入恒同输出，不依赖外部状态", () => {
    const required: HostCapability[] = ["mount"];
    const available: HostCapability[] = ["video"];
    const first = missingHostCapabilities(required, available);
    const second = missingHostCapabilities(required, available);
    expect(first).toEqual(second);
    expect(first).toEqual(["mount"]);
    // 入参不被改写（纯函数无副作用）
    expect(required).toEqual(["mount"]);
    expect(available).toEqual(["video"]);
  });
});

describe("HostInfo 能力面只增（hostinfo-capabilities-additive）", () => {
  it("resolveHost 仍只产 {os,form}——能力是宿主组合根的声明，不是平台探测", () => {
    const info = resolveHost("windows");
    expect(info.os).toBe("windows");
    expect(info.form).toBe("desktop");
    expect(info.capabilities).toBeUndefined();
  });

  it("capabilities 可选：既有 {os,form} 形状合法，附加能力也合法", () => {
    const bare: HostInfo = { os: "unknown", form: "mobile" };
    expect(bare.capabilities).toBeUndefined();
    const declared: HostInfo = {
      os: "unknown",
      form: "mobile",
      capabilities: ["video", "audio", "storage", "i18n"],
    };
    expect(declared.capabilities).toEqual([
      "video",
      "audio",
      "storage",
      "i18n",
    ]);
    // 只增可选：不带 capabilities 的旧消费方读 os/form 不受影响
    expect(declared.os).toBe(bare.os);
    expect(declared.form).toBe(bare.form);
  });
});
