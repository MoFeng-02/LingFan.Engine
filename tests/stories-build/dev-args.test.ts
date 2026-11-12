/**
 * 直达参数解析的判据。
 *
 * 这一层是纯函数，因此断言直接比对解析结果，不经过任何 I/O。
 * 钉住的是三件容易回归的事：三种取值写法必须等价、裸分隔符必须被跳过
 * （各家包管理器透传时形态不一，多带一个分隔符就会变成一个多余参数）、
 * 以及未知选项必须报错——放行了拼错的选项，报错会指向下游工具，排查方向被带偏。
 */
import { describe, expect, it } from "vitest";
import { parseDevArgs } from "../../packages/stories-build/src/dev/args.ts";

describe("parseDevArgs", () => {
  it("三种取值写法等价：空格、等号、位置参数", () => {
    const spaced = parseDevArgs(["--story-name", "inn"]);
    const inlined = parseDevArgs(["--story-name=inn"]);
    const positional = parseDevArgs(["inn"]);
    expect(spaced.storyName).toBe("inn");
    expect(inlined.storyName).toBe("inn");
    expect(positional.storyName).toBe("inn");
  });

  it("裸分隔符一律跳过：分隔符后的内容按原序继续解析", () => {
    const result = parseDevArgs(["--", "--story-name", "inn"]);
    expect(result.storyName).toBe("inn");
  });

  it("多个分隔符都跳过，且不产生多余参数", () => {
    const result = parseDevArgs(["--", "--", "--story-name=inn"]);
    expect(result.storyName).toBe("inn");
    expect(result.passthrough).toEqual([]);
  });

  it("无参数时是普通启动：没有章节、没有开关", () => {
    const result = parseDevArgs([]);
    expect(result.storyName).toBeUndefined();
    expect(result.listEntries).toBe(false);
    expect(result.help).toBe(false);
    expect(result.passthrough).toEqual([]);
  });

  it("查询开关各自独立：清单与帮助", () => {
    expect(parseDevArgs(["--list-entries"]).listEntries).toBe(true);
    expect(parseDevArgs(["--help"]).help).toBe(true);
    expect(parseDevArgs(["-h"]).help).toBe(true);
  });

  it("构建模式选项进透传列表，原样带给下游", () => {
    expect(parseDevArgs(["--mode", "tauri"]).passthrough).toEqual([
      "--mode",
      "tauri",
    ]);
    expect(parseDevArgs(["--mode=tauri"]).passthrough).toEqual([
      "--mode=tauri",
    ]);
  });

  it("章节参数与构建模式选项可以同时给", () => {
    const result = parseDevArgs(["--story-name", "inn", "--mode", "tauri"]);
    expect(result.storyName).toBe("inn");
    expect(result.passthrough).toEqual(["--mode", "tauri"]);
  });

  it("缺取值时报错：不是当成布尔开关", () => {
    expect(() => parseDevArgs(["--story-name"])).toThrow(/列 id/);
    expect(() => parseDevArgs(["--story-name", "--list-entries"])).toThrow(
      /列 id/,
    );
    expect(() => parseDevArgs(["--story-name="])).toThrow(/列 id/);
  });

  it("未知选项报错；放到透传模式时改为收进透传列表", () => {
    expect(() => parseDevArgs(["--bogus"])).toThrow(/未知选项/);
    const passed = parseDevArgs(["--bogus"], { foreign: "passthrough" });
    expect(passed.passthrough).toEqual(["--bogus"]);
  });

  it("多余的位置参数报错", () => {
    expect(() => parseDevArgs(["inn", "start"])).toThrow(/多余的参数/);
  });
});
