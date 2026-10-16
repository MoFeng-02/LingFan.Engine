/**
 * 注释纪律互锁（对应章节，源级扫描，不跑构建）：禁止把「会随时间失效的信息」写进源码注释。
 *
 * 禁止面（对应章节 只允许写「是什么 / 为什么 / 怎么用 / 注意事项」）：
 * - 分组计数：「// 文本（4）」这类数字必须随分组增删手工同步，漏改一行就成错信息；
 * - 任务编号与本次：「任务」「缺陷」「本次」属于任务清单，不是模块知识；
 * - 进度用词：「待办」「已修」「里程碑」等进度状态会随推进失效；
 * - 清单用词：「清单」「整改」「检查报告」「任务表」是过程文档的词，不该进源码；
 * - 临时实测数字：「eff」「有效行」「超软」「硬限」是整改时的量尺，不是接口语义；
 * - 待办标记：「TODO / FIXME / XXX / HACK」应落在任务清单；
 * - 表情符号。
 *
 * 语义例外：「本轮」在 watch / 迭代器里指「本次构建 / 本次循环」，是领域词，不在禁止面。
 * 判据只看注释（行注释 + 块注释，含代码后的尾随注释），且跳过引号内的伪注释，
 * 避免把 URL、模板串、选择器里的词当成注释。
 */
import { describe, expect, it } from "vitest";

const SRC = import.meta.glob(
  [
    "../../packages/*/src/**/*.ts",
    "../../packages/*/src/**/*.vue",
    "../../apps/*/src/**/*.ts",
    "../../apps/*/src/**/*.vue",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/** 禁止面：[标签, 匹配注释文本的正则] */
const BANNED: Array<[string, RegExp]> = [
  ["分组计数", /^(?:\/\/|\*)\s*.*(?:（\d+）|族\s+\d+)\s*$/],
  [
    "任务编号",
    /(?:^|[^A-Za-z0-9])(?:[TRDEC]\d{2}-\d{2}|[TRDEC]-\d{2})(?![0-9])/,
  ],
  ["本次/进度词", /本次|待办|已修|未修|未开工|里程碑/],
  ["清单用词", /清单|整改|检查报告|任务表/],
  ["临时实测数字", /\beff\b|有效行|超软|硬限/],
  ["待办标记", /\b(?:TODO|FIXME|XXX|HACK)\b/],
  ["表情符号", /\p{Emoji_Presentation}/u],
];

/** 抽出注释行文本（带行号）；字符串字面量里的伪注释不算 */
function commentLines(source: string): Array<{ no: number; text: string }> {
  const out: Array<{ no: number; text: string }> = [];
  let inBlock = false;
  source.split(/\r?\n/).forEach((line, index) => {
    const no = index + 1;
    if (inBlock) {
      out.push({ no, text: line });
      if (line.includes("*/")) inBlock = false;
      return;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith("/*")) {
      out.push({ no, text: line });
      if (!trimmed.includes("*/")) inBlock = true;
      return;
    }
    if (trimmed.startsWith("//")) {
      out.push({ no, text: trimmed });
      return;
    }
    const slash = line.indexOf("//");
    if (slash !== -1 && !/["'`]/.test(line.slice(0, slash))) {
      out.push({ no, text: line.slice(slash) });
    }
  });
  return out;
}

/** 命中禁止面的注释（判据本体，便于自证） */
function violations(source: string): string[] {
  return commentLines(source)
    .map(({ no, text }) => {
      const hit = BANNED.find(([, pattern]) => pattern.test(text));
      return hit === undefined ? null : `${no} [${hit[0]}] ${text.trim()}`;
    })
    .filter((item): item is string => item !== null);
}

describe("注释纪律（对应章节）", () => {
  it("扫描面自检：命中源码文件（glob 失配时立刻失败）", () => {
    expect(Object.keys(SRC).length).toBeGreaterThanOrEqual(100);
  });

  it("判据自证：各类禁止面判红，语义例外与正常注释判绿", () => {
    expect(violations("// 文本（4）")).toEqual(["1 [分组计数] // 文本（4）"]);
    expect(violations("// 进度族 5")).toEqual(["1 [分组计数] // 进度族 5"]);
    expect(violations("// 见 任务 决定")).toEqual([
      "1 [任务编号] // 见 任务 决定",
    ]);
    expect(violations("// 本本次产物")).toEqual([
      "1 [本次/进度词] // 本本次产物",
    ]);
    expect(violations("// 见任务清单")).toEqual(["1 [清单用词] // 见任务清单"]);
    expect(violations("// eff 296")).toEqual(["1 [临时实测数字] // eff 296"]);
    expect(violations("// TODO 补测试")).toEqual([
      "1 [待办标记] // TODO 补测试",
    ]);
    expect(violations("// 完成 ✅")).toEqual(["1 [表情符号] // 完成 ✅"]);
    for (const clean of [
      "// 文本\n// 进度 / 滑块 / 选择",
      "// 本轮产物差量（相对上一轮落盘状态）",
      "const url = 'https://example.com/a#b'; // 宿主地址（↔ 端口注入）",
      "// 效果（effect）与效率",
      "// 见 对应章节 出口转发",
    ]) {
      expect(violations(clean), clean).toEqual([]);
    }
  });

  it("全仓注释无禁止面命中", () => {
    const offenders = Object.entries(SRC)
      .map(([key, source]) => {
        const hits = violations(source);
        return hits.length === 0
          ? null
          : `${key.replace(/^(\.\.\/)+/, "")} —— ${hits.join(" | ")}`;
      })
      .filter((item): item is string => item !== null);
    expect(
      offenders,
      "注释只写「是什么 / 为什么 / 怎么用 / 注意」：编号、进度、清单词、实测数字、待办标记与表情都不进源码",
    ).toEqual([]);
  });
});
