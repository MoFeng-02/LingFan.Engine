/**
 * T03-03 写回规范化检测（锚点 save-normalization-notice）：
 * 「打开形态 → 标准布局」的文件级动作判定——保存前提示的事实依据。
 *
 * 判定只看路径形态（与 `serializeProject` 同一布局规则：每列一个 `Stories/<id>.json`）。
 * 五类纪律：拟态旅程（混合形态工程）/ 故意错误（不安全列 id / 大小写 / 怪路径）/
 * 边界（空输入 / 空列集 / 子目录）/ 不变量（输入不被修改、确定性、码元序输出）。
 */
import { describe, expect, it } from "vitest";
import { detectWriteNormalization } from "@lingfan/engine";

const COLUMNS = ["title_main", "start", "keep"];

describe("detectWriteNormalization（save-normalization-notice）", () => {
  it("拟态旅程：.story 转换 + 多列/陈旧移除；规范文件与 Stories 外路径不报", () => {
    const finding = detectWriteNormalization(
      [
        "project.json",
        "Audio/bgm.mp3",
        "Lang/zh.json",
        "Stories/start.json",
        "Stories/title_main.story",
        "Stories/ch1.json",
        "Stories/old.json",
        "Stories/keep.json",
      ],
      COLUMNS,
    );
    expect(finding).toEqual({
      toConvert: ["Stories/title_main.story"],
      toRemove: ["Stories/ch1.json", "Stories/old.json"],
    });
  });

  it("规范布局零发现：每列一个 <id>.json；project.json 不在检测面", () => {
    const finding = detectWriteNormalization(
      [
        "project.json",
        "Stories/start.json",
        "Stories/keep.json",
        "Stories/title_main.json",
      ],
      COLUMNS,
    );
    expect(finding).toEqual({ toConvert: [], toRemove: [] });
  });

  it("同列 story 与 json 并存：json 是规范态，story 报转换（旧形态清理）", () => {
    const finding = detectWriteNormalization(
      ["Stories/x.story", "Stories/x.json", "project.json"],
      ["x"],
    );
    expect(finding).toEqual({ toConvert: ["Stories/x.story"], toRemove: [] });
  });

  it("边界：空列集 → 打开的 Stories 文件如实全部报移除（保存将清空引用）", () => {
    const finding = detectWriteNormalization(
      ["Stories/a.json", "Stories/b.story"],
      [],
    );
    expect(finding).toEqual({
      toConvert: [],
      toRemove: ["Stories/a.json", "Stories/b.story"],
    });
  });

  it("边界：空输入 → 空发现", () => {
    expect(detectWriteNormalization([], COLUMNS)).toEqual({
      toConvert: [],
      toRemove: [],
    });
  });

  it("故意错误：.story 文件名段不在列集 → 移除而非转换；子目录/点文件/怪后缀 → 移除", () => {
    const finding = detectWriteNormalization(
      [
        "Stories/gone.story",
        "Stories/sub/x.json",
        "Stories/.hidden.json",
        "Stories/notes.txt",
        "Stories/..",
      ],
      COLUMNS,
    );
    expect(finding).toEqual({
      toConvert: [],
      toRemove: [
        "Stories/..",
        "Stories/.hidden.json",
        "Stories/gone.story",
        "Stories/notes.txt",
        "Stories/sub/x.json",
      ],
    });
  });

  it("故意错误：不安全列 id 不构标准键（真保存由 serializeProject 整批拒绝，检测不抢跑）", () => {
    const finding = detectWriteNormalization(
      ["Stories/a.json", "Stories/keep.json"],
      ["a/b", "..", ".dot", "keep"],
    );
    expect(finding).toEqual({
      toConvert: [],
      toRemove: ["Stories/a.json"],
    });
  });

  it("故意错误：大小写敏感 = 文件系统语义（Stories/A.json 与列 a 是不同文件）", () => {
    const finding = detectWriteNormalization(["Stories/A.json"], ["a"]);
    expect(finding).toEqual({
      toConvert: [],
      toRemove: ["Stories/A.json"],
    });
  });

  it("不变量：输入恒不被修改；同输入两次调用确定性等价；输出按码元序", () => {
    const opened = ["Stories/z.json", "Stories/b.story", "project.json"];
    const snapshot = [...opened];
    const one = detectWriteNormalization(opened, ["a"]);
    const two = detectWriteNormalization(opened, ["a"]);
    expect(opened).toEqual(snapshot);
    expect(one).toEqual(two);
    expect(one.toRemove).toEqual(["Stories/b.story", "Stories/z.json"]);
  });
});
