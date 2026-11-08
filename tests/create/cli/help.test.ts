/**
 * 帮助文本的判据。
 *
 * 帮助是自动化调用者的唯一说明书：命令怎么写、什么情况下会被问答拦住、
 * CI 里怎么用参数绕开问答。这里钉住的都是「照抄就能跑」的条件——
 * 缺了 bun 那一行，bun 用户会以为自己不能用；留着 `--` 转义，抄下去就多一个
 * 位置参数；把 `--template` 摆在首屏，人又会以为形态还得靠它指定。
 */
import { describe, expect, it } from "vitest";
import { defaultCreateTexts } from "../../../packages/create/src/shared/texts.ts";

const help = defaultCreateTexts.help;
const lines = help.split("\n");

/** 取从标题行到下一个空行为止的段落 */
function section(title: string): string[] {
  const start = lines.findIndex((line) => line.startsWith(title));
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") break;
    out.push(line);
  }
  return out;
}

describe("帮助文本", () => {
  it("三种包管理器的用法都在", () => {
    expect(help).toContain("npm create @lingfan-engine");
    expect(help).toContain("pnpm create @lingfan-engine");
    expect(help).toContain("bun create @lingfan-engine");
  });

  it("用法段不带 `--` 转义，也不留 `[选项]` 占位", () => {
    const usage = section("用法：");
    expect(usage.length).toBeGreaterThan(0);
    for (const line of usage) {
      expect(line).not.toContain("--");
      expect(line).not.toContain("[选项]");
    }
  });

  it("全文没有 `-- --flag` 这种把参数透传给 create 的旧写法", () => {
    expect(help).not.toMatch(/--\s+--[a-z]/);
  });

  it("示例区也不带 `--` 转义", () => {
    const examples = section("示例：");
    expect(examples.length).toBeGreaterThan(0);
    for (const line of examples) {
      expect(line).not.toContain("-- ");
    }
  });

  it("yarn 那条说清了版本要求", () => {
    expect(help).toContain("yarn");
    expect(help).toMatch(/2 及以上/);
  });

  it("yarn 用户拿得到等价写法", () => {
    expect(help).toContain("yarn dlx");
  });

  it("选项段里没有 `--template`", () => {
    const options = section("选项：");
    expect(options.length).toBeGreaterThan(0);
    expect(options.join("\n")).not.toContain("--template");
  });

  it("`--template` 仍在脚本用法段里给出", () => {
    const scripted = section("脚本用法：");
    expect(scripted.join("\n")).toContain("--template");
  });

  it("描述参数出现在选项段", () => {
    const options = section("选项：");
    expect(options.join("\n")).toContain("--description");
  });

  it("说清了工程名之后会按提示问答", () => {
    expect(help).toContain("工程名");
    expect(help).toContain("形态");
  });

  it("脚本用法段列出三个形态维度", () => {
    const scripted = section("脚本用法：").join("\n");
    expect(scripted).toContain("--framework");
    expect(scripted).toContain("--shell");
    expect(scripted).toContain("--sources");
  });

  it("帮助里没有空的占位段落", () => {
    expect(lines.every((line) => !line.includes("TODO"))).toBe(true);
  });
});
