import { describe, expect, it } from "vitest";
import { createHostPort } from "@lingfan-engine/adapters";
import { resolveHost } from "@lingfan-engine/core";

describe("createHostPort（宿主端口适配器）", () => {
  it("解析并缓存宿主事实（get 返回同一快照）", () => {
    const port = createHostPort({ platform: "android" });
    const first = port.get();
    expect(first).toEqual({ os: "android", form: "mobile" });
    expect(port.get()).toBe(first);
  });

  it("无平台来源（浏览器形态）→ unknown·desktop（显式未知）", () => {
    const port = createHostPort({ platform: undefined });
    expect(port.get()).toEqual({ os: "unknown", form: "desktop" });
  });

  it("resolveHost 供解析语义（映射 Tauri 平台串）", () => {
    expect(resolveHost(" ios ")).toEqual({ os: "ios", form: "mobile" });
    expect(resolveHost("freebsd")).toEqual({ os: "unknown", form: "desktop" });
  });
});

describe("createHostPort：能力声明合并（hostinfo-capabilities-additive）", () => {
  it("组合根声明能力 → 并入 HostInfo（os/form 不变，只增 capabilities）", () => {
    const port = createHostPort({
      platform: "windows",
      capabilities: ["video", "audio", "mount", "body", "storage", "i18n"],
    });
    const info = port.get();
    expect(info.os).toBe("windows");
    expect(info.form).toBe("desktop");
    expect(info.capabilities).toEqual([
      "video",
      "audio",
      "mount",
      "body",
      "storage",
      "i18n",
    ]);
    expect(port.get()).toBe(info);
  });

  it("受限宿主声明子集（小程序无 mount/body）→ 如实并入", () => {
    const port = createHostPort({
      platform: undefined,
      capabilities: ["video", "audio", "storage", "i18n"],
    });
    const info = port.get();
    expect(info.os).toBe("unknown");
    expect(info.capabilities).toEqual(["video", "audio", "storage", "i18n"]);
    expect(info.capabilities).not.toContain("mount");
  });

  it("不声明能力 → capabilities 留空（既有 {os,form} 形状不变）", () => {
    const port = createHostPort({ platform: "macos" });
    expect(port.get()).toEqual({ os: "macos", form: "desktop" });
    expect(port.get().capabilities).toBeUndefined();
  });

  it("声明空集 → capabilities 为空数组（显式未声明任何能力，区别于缺省）", () => {
    const port = createHostPort({ platform: "linux", capabilities: [] });
    expect(port.get().capabilities).toEqual([]);
  });
});
