/**
 * 形态多选的判据：怎么读一组输入、以及怎么从 `excludes` 推出互斥。
 *
 * 这两件事一起测，是因为它们必须互相配套：解析层不许自己知道「Vue 与 React 不能
 * 共存」这类知识，它只把输入翻成层 id；互斥判断一律由元数据里的 `excludes` 推导。
 * 所以这里既钉「输入怎么读」，也钉「撞上互斥时到底报了哪两层」——只报一个 id
 * 等于让人自己回表里查是谁跟谁打架。
 *
 * 层表取自仓库里的真实 `template-meta.json`：改成夹具就等于只测夹具自洽，
 * 而这里要钉的恰恰是「真实元数据声明出来的互斥是否被正确读出」。
 */
import { describe, expect, it } from "vitest";
import {
  findLayerConflicts,
  parseLayerAnswer,
} from "../../../packages/create/src/cli/prompts.ts";
import {
  readTemplateMeta,
  resolveTemplateRoot,
  selectableLayers,
} from "../../../packages/create/src/registry/template-meta.ts";

const templateRoot = resolveTemplateRoot()!;
const meta = readTemplateMeta(templateRoot);
const layers = selectableLayers(templateRoot, meta);
const ids = layers.map((option) => option.id);

/** 层 id 在选项面上的序号（从 1 起）；找不到即说明元数据变了，测试要一起改 */
function indexOf(id: string): string {
  const index = ids.indexOf(id);
  if (index < 0) throw new Error(`选项面里没有这一层：${id}`);
  return String(index + 1);
}

describe("parseLayerAnswer", () => {
  it("选项面按 框架 → 壳 拼接，且只留有目录的层", () => {
    // 故事源不参与形态问答：三种创作形态共存于同一棵 Resources/Stories/ 树，
    // 勾选它没有「叠一层」的含义，只在脚本参数面（--sources）保留。
    expect(ids).toEqual(["vue", "react", "tauri", "miniprogram"]);
  });

  it("单个序号", () => {
    expect(parseLayerAnswer(layers, "1")).toEqual(["vue"]);
  });

  it("空格分隔", () => {
    expect(parseLayerAnswer(layers, "1 3")).toEqual(["vue", "tauri"]);
  });

  it("半角逗号分隔", () => {
    expect(parseLayerAnswer(layers, "1,3")).toEqual(["vue", "tauri"]);
  });

  it("全角逗号分隔：中文输入法下的常态写法", () => {
    expect(parseLayerAnswer(layers, "1，3")).toEqual(["vue", "tauri"]);
  });

  it("空格与逗号混用、顺序按输入", () => {
    expect(parseLayerAnswer(layers, " 3 , 1 ")).toEqual(["tauri", "vue"]);
  });

  it("重复选择去重且保留首次出现的位置", () => {
    expect(parseLayerAnswer(layers, "3 1 3")).toEqual(["tauri", "vue"]);
  });

  it("空输入是空集而不是错误", () => {
    expect(parseLayerAnswer(layers, "")).toEqual([]);
    expect(parseLayerAnswer(layers, "   ")).toEqual([]);
    expect(parseLayerAnswer(layers, " , ")).toEqual([]);
  });

  it("也认层 id", () => {
    expect(parseLayerAnswer(layers, "vue tauri")).toEqual(["vue", "tauri"]);
  });

  it("越界序号认不出", () => {
    expect(parseLayerAnswer(layers, "5")).toBeUndefined();
    expect(parseLayerAnswer(layers, "6")).toBeUndefined();
    expect(parseLayerAnswer(layers, "0")).toBeUndefined();
  });

  it("不再出现在选项面的故事源，按序号与 id 都认不出", () => {
    // 它仍有目录，但已退出形态问答；脚本面走 --sources，问答面不该静默接受它。
    expect(parseLayerAnswer(layers, "story")).toBeUndefined();
  });

  it("非数字且不是已知 id 时认不出", () => {
    expect(parseLayerAnswer(layers, "1 x")).toBeUndefined();
  });
});

describe("findLayerConflicts", () => {
  it("空集没有冲突", () => {
    expect(findLayerConflicts([], layers)).toEqual([]);
  });

  it("单层没有冲突", () => {
    expect(findLayerConflicts(["vue"], layers)).toEqual([]);
    expect(findLayerConflicts(["miniprogram"], layers)).toEqual([]);
  });

  it("Vue 与 React 不能共存", () => {
    expect(findLayerConflicts(["vue", "react"], layers)).toEqual([
      ["vue", "react"],
    ]);
  });

  it("Vue 与小程序不能共存", () => {
    expect(findLayerConflicts(["vue", "miniprogram"], layers)).toHaveLength(1);
  });

  it("React 与小程序不能共存", () => {
    expect(findLayerConflicts(["react", "miniprogram"], layers)).toHaveLength(
      1,
    );
  });

  it("桌面壳与小程序不能共存", () => {
    expect(findLayerConflicts(["tauri", "miniprogram"], layers)).toHaveLength(
      1,
    );
  });

  it("Vue 加桌面壳合法", () => {
    expect(findLayerConflicts(["vue", "tauri"], layers)).toEqual([]);
  });

  it("故事源不再进选项面，因此也不参与互斥判定", () => {
    // 脚本面仍可用 --sources story；问答面的层表里没有它，选中集合里出现它
    // 只说明调用方传了层表之外的 id，不构成互斥对。
    expect(findLayerConflicts(["vue", "story"], layers)).toEqual([]);
    expect(findLayerConflicts(["miniprogram", "story"], layers)).toEqual([]);
  });

  it("一对互斥只报一次，不因两边都写了声明而重复", () => {
    expect(findLayerConflicts(["vue", "react"], layers)).toHaveLength(1);
    expect(findLayerConflicts(["react", "vue"], layers)).toHaveLength(1);
  });

  it("互斥按选项面顺序出对，与输入顺序无关", () => {
    const forward = findLayerConflicts(["react", "vue"], layers);
    const backward = findLayerConflicts(["vue", "react"], layers);
    expect(forward).toEqual(backward);
  });

  it("多层同时撞上两对时两对都报", () => {
    const conflicts = findLayerConflicts(
      ["vue", "react", "miniprogram"],
      layers,
    );
    expect(conflicts).toHaveLength(3);
  });

  it("序号能落到具体的互斥对上", () => {
    const picked = parseLayerAnswer(
      layers,
      `${indexOf("vue")} ${indexOf("react")}`,
    );
    expect(picked).toBeDefined();
    expect(findLayerConflicts(picked!, layers)).toEqual([["vue", "react"]]);
  });
});
