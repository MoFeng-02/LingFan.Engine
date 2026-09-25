import { describe, expect, it } from "vitest";
import { resolveHost } from "@lingfan/engine";

describe("resolveHost（宿主信息解析）", () => {
  it("映射 Tauri 的五种编译期平台", () => {
    expect(resolveHost("windows")).toEqual({ os: "windows", form: "desktop" });
    expect(resolveHost("macos")).toEqual({ os: "macos", form: "desktop" });
    expect(resolveHost("linux")).toEqual({ os: "linux", form: "desktop" });
    expect(resolveHost("android")).toEqual({ os: "android", form: "mobile" });
    expect(resolveHost("ios")).toEqual({ os: "ios", form: "mobile" });
  });

  it("大小写与首尾空白不敏感", () => {
    expect(resolveHost(" Android ")).toEqual({ os: "android", form: "mobile" });
    expect(resolveHost("iOS")).toEqual({ os: "ios", form: "mobile" });
    expect(resolveHost(" Windows")).toEqual({ os: "windows", form: "desktop" });
  });

  it("未知/缺省 → unknown·desktop（显式未知，不猜）", () => {
    expect(resolveHost(undefined)).toEqual({ os: "unknown", form: "desktop" });
    expect(resolveHost("")).toEqual({ os: "unknown", form: "desktop" });
    expect(resolveHost("   ")).toEqual({ os: "unknown", form: "desktop" });
    expect(resolveHost("freebsd")).toEqual({ os: "unknown", form: "desktop" });
  });
});
