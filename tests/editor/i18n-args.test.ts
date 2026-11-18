/**
 * i18n CLI 参数解析测试。
 *
 * 测试要点：
 * - 子命令与工程根三级回落（位置参数 → 注入的 DSH_I18N_ROOT → 注入的 cwd）；
 * - --flag=value 与 --flag value 双形态；缺值/未知选项/未知子命令/多余位置参数 fail-closed；
 * - 枚举校验（layout/placeholder/fail-on）报参数名与合法取值；
 * - skeleton/report 必填 --lang；布尔开关默认关；缺省值与设计口径一致。
 */
import { describe, expect, it } from "vitest";
import { parseI18nArgs } from "../../packages/editor/src/cli/args.ts";

const CTX = { cwd: "/work/game" };

describe("parseI18nArgs · 子命令与工程根", () => {
  it("四个子命令都认，缺省值齐备", () => {
    for (const command of ["scan", "skeleton", "report", "check"] as const) {
      const argv =
        command === "skeleton" || command === "report"
          ? [command, "--lang=en"]
          : [command];
      const args = parseI18nArgs(argv, CTX);
      expect(args.command).toBe(command);
      expect(args.root).toBe("/work/game");
      expect(args.layout).toBe("per-story");
      expect(args.placeholder).toBe("original");
      expect(args.failOn).toBe("missing");
      expect(args.json).toBe(false);
      expect(args.prune).toBe(false);
      expect(args.all).toBe(false);
    }
  });

  it("工程根三级回落：位置参数 > envRoot > cwd", () => {
    expect(
      parseI18nArgs(["scan", "./a"], { cwd: "/w", envRoot: "/e" }).root,
    ).toBe("./a");
    expect(parseI18nArgs(["scan"], { cwd: "/w", envRoot: "/e" }).root).toBe(
      "/e",
    );
    expect(parseI18nArgs(["scan"], { cwd: "/w", envRoot: "" }).root).toBe("/w");
    expect(parseI18nArgs(["scan"], { cwd: "/w" }).root).toBe("/w");
  });

  it("缺子命令/未知子命令/多余位置参数 fail-closed", () => {
    expect(() => parseI18nArgs([], CTX)).toThrow(/缺少子命令/);
    expect(() => parseI18nArgs(["build"], CTX)).toThrow(/未知子命令：build/);
    expect(() => parseI18nArgs(["scan", "a", "b"], CTX)).toThrow(
      /只接受一个工程根位置参数/,
    );
  });
});

describe("parseI18nArgs · 选项形态", () => {
  it("--flag=value 与 --flag value 等价", () => {
    const inline = parseI18nArgs(
      ["scan", "--layout=main", "--lang", "en"],
      CTX,
    );
    const spaced = parseI18nArgs(
      ["scan", "--layout", "main", "--lang=en"],
      CTX,
    );
    expect(inline).toEqual(spaced);
    expect(inline.layout).toBe("main");
    expect(inline.lang).toBe("en");
  });

  it("目录类选项透传（scan-dir/stories-dir/resources-dir）", () => {
    const args = parseI18nArgs(
      [
        "skeleton",
        "--lang=en",
        "--scan-dir=src/host",
        "--stories-dir",
        "Resources/Stories",
        "--resources-dir=Resources",
      ],
      CTX,
    );
    expect(args.scanDir).toBe("src/host");
    expect(args.storiesDir).toBe("Resources/Stories");
    expect(args.resourcesDir).toBe("Resources");
  });

  it("布尔开关只认裸形态，置位后为 true", () => {
    const args = parseI18nArgs(["check", "--json", "--prune", "--all"], CTX);
    expect(args.json).toBe(true);
    expect(args.prune).toBe(true);
    expect(args.all).toBe(true);
    expect(() => parseI18nArgs(["scan", "--json=true"], CTX)).toThrow(
      /未知选项：--json=true/,
    );
  });

  it("缺值报参数名（含 --flag= 空值后无下一个参数）", () => {
    expect(() => parseI18nArgs(["scan", "--lang"], CTX)).toThrow(
      /--lang 需要一个值/,
    );
    expect(() => parseI18nArgs(["scan", "--scan-dir="], CTX)).toThrow(
      /--scan-dir 需要一个值/,
    );
    expect(() => parseI18nArgs(["scan", "--bogus"], CTX)).toThrow(
      /未知选项：--bogus/,
    );
  });
});

describe("parseI18nArgs · 枚举与必填校验", () => {
  it("layout/placeholder/fail-on 非法值报参数名与合法取值", () => {
    expect(() => parseI18nArgs(["scan", "--layout=flat"], CTX)).toThrow(
      /--layout 取值非法：flat（可用：single\|main\|per-story）/,
    );
    expect(() => parseI18nArgs(["scan", "--placeholder=none"], CTX)).toThrow(
      /--placeholder 取值非法：none（可用：original\|empty）/,
    );
    expect(() => parseI18nArgs(["check", "--fail-on=all"], CTX)).toThrow(
      /--fail-on 取值非法：all（可用：missing\|unused\|any）/,
    );
  });

  it("合法枚举值逐一遍历", () => {
    for (const layout of ["single", "main", "per-story"] as const) {
      expect(parseI18nArgs(["scan", `--layout=${layout}`], CTX).layout).toBe(
        layout,
      );
    }
    for (const placeholder of ["original", "empty"] as const) {
      expect(
        parseI18nArgs(["scan", `--placeholder=${placeholder}`], CTX)
          .placeholder,
      ).toBe(placeholder);
    }
    for (const failOn of ["missing", "unused", "any"] as const) {
      expect(parseI18nArgs(["check", `--fail-on=${failOn}`], CTX).failOn).toBe(
        failOn,
      );
    }
  });

  it("skeleton/report 必填 --lang；scan/check 可选", () => {
    expect(() => parseI18nArgs(["skeleton"], CTX)).toThrow(
      /skeleton 需要 --lang/,
    );
    expect(() => parseI18nArgs(["report"], CTX)).toThrow(/report 需要 --lang/);
    expect(parseI18nArgs(["scan"], CTX).lang).toBeUndefined();
    expect(parseI18nArgs(["check"], CTX).lang).toBeUndefined();
  });
});

describe("--functions · 别名清单显式配置（Q18：不隐式猜测）", () => {
  it('缺省不携带 functions（回落交给 IO 层读清单，再回落 ["t"]）', () => {
    expect(parseI18nArgs(["scan"], CTX).functions).toBeUndefined();
  });

  it("双形态：--functions=t,tr 与 --functions t,tr 等价，逗号分隔", () => {
    expect(parseI18nArgs(["scan", "--functions=t,tr"], CTX).functions).toEqual([
      "t",
      "tr",
    ]);
    expect(
      parseI18nArgs(["scan", "--functions", "t,tr"], CTX).functions,
    ).toEqual(["t", "tr"]);
  });

  it("逗号空段原样保留（空名 fail-closed 判定在扫描器，不在参数层吞掉）", () => {
    expect(parseI18nArgs(["scan", "--functions=t,"], CTX).functions).toEqual([
      "t",
      "",
    ]);
  });

  it("空内联值（--functions=）属缺值：参数层 fail-closed（照 stories-build CLI 模型）", () => {
    expect(() => parseI18nArgs(["scan", "--functions="], CTX)).toThrow(
      /--functions 需要一个值/,
    );
  });

  it("缺值报错（与其他值 flag 同文案）", () => {
    expect(() => parseI18nArgs(["scan", "--functions"], CTX)).toThrow(
      /--functions 需要一个值/,
    );
  });
});
