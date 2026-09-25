import { describe, expect, it } from "vitest";
import { createHostPort } from "@lingfan/adapters";
import { resolveHost } from "@lingfan/engine";

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
