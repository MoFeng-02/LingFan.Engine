/**
 * 命令行解析的判据。
 *
 * 这一层是纯函数，因此断言直接比对 `CreateArgs` 的取值，不经过任何 I/O。
 * 两件容易回归的事各钉一遍：`--flag value` 与 `--flag=value` 必须等价（脚本两种
 * 写法都在用），以及把取值写丢时必须是「缺取值」而不是悄悄当成布尔开关——
 * 后者会让 `--description` 拿到上一段文字，产物里出现一句谁也没写过的描述。
 */
import { describe, expect, it } from "vitest";
import { parseArgs } from "../../../packages/create/src/cli/cli.ts";

describe("parseArgs", () => {
  it("`--flag value` 与 `--flag=value` 等价", () => {
    const spaced = parseArgs([
      "my-story",
      "--description",
      "试菜单的小工程",
      "--framework",
      "vue",
      "--shell",
      "tauri",
      "--sources",
      "story",
      "--dir",
      "out",
    ]);
    const inlined = parseArgs([
      "my-story",
      "--description=试菜单的小工程",
      "--framework=vue",
      "--shell=tauri",
      "--sources=story",
      "--dir=out",
    ]);
    expect(spaced).toEqual({
      projectName: "my-story",
      description: "试菜单的小工程",
      template: undefined,
      framework: "vue",
      shell: "tauri",
      sources: "story",
      dir: "out",
      install: false,
      existing: undefined,
      yes: false,
      help: false,
    });
    expect(inlined).toEqual(spaced);
  });

  it("短选项与长选项同义", () => {
    const args = parseArgs([
      "-f",
      "react",
      "-s",
      "browser",
      "-t",
      "ts",
      "-d",
      "out",
      "-y",
    ]);
    expect(args.framework).toBe("react");
    expect(args.shell).toBe("browser");
    expect(args.sources).toBe("ts");
    expect(args.dir).toBe("out");
    expect(args.yes).toBe(true);
  });

  it("`--description` 收下带空格的中文描述", () => {
    expect(parseArgs(["--description", "一个 有空格 的描述"]).description).toBe(
      "一个 有空格 的描述",
    );
  });

  it("`--description=` 允许空串：那等于没写描述", () => {
    expect(parseArgs(["--description="]).description).toBe("");
  });

  it("未知选项报错并带上选项名", () => {
    expect(() => parseArgs(["--layers", "1 3"])).toThrow("--layers");
  });

  it("选项缺取值报错而不是吞掉下一个选项", () => {
    expect(() => parseArgs(["--description", "--yes"])).toThrow(
      "--description",
    );
    expect(() => parseArgs(["my-story", "--dir"])).toThrow("--dir");
  });

  it("多余的位置参数报错并带上那个参数", () => {
    expect(() => parseArgs(["first", "second"])).toThrow("second");
  });

  it("`--no-install` 关掉安装，`--install` 打开", () => {
    expect(parseArgs([]).install).toBe(false);
    expect(parseArgs(["--install"]).install).toBe(true);
    expect(parseArgs(["--install", "--no-install"]).install).toBe(false);
  });

  it('`--overwrite` 落成 `existing: "clear"`', () => {
    expect(parseArgs(["--overwrite"]).existing).toBe("clear");
    expect(parseArgs([]).existing).toBeUndefined();
  });

  it("`--help` 与 `--yes` 各自独立", () => {
    expect(parseArgs(["-h"]).help).toBe(true);
    expect(parseArgs(["-h"]).yes).toBe(false);
  });

  it("第一个位置参数是工程名，`--` 开头的不算", () => {
    expect(parseArgs(["my-story"]).projectName).toBe("my-story");
    expect(parseArgs([]).projectName).toBeUndefined();
    expect(() => parseArgs(["--my-story"])).toThrow("未知选项");
  });
});
