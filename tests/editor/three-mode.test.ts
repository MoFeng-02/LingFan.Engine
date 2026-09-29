/**
 * T09-03 三模式一致性互锁（JSON / DSL / TS）。
 * 锚点: three-mode-consistency
 *
 * 测试纪律：
 * - 同一故事的三种创作形态（TS 源默认导出 = 编译口径的值；多列 JSON 文件；文本 DSL）
 *   必须产出**逐字段相同**的 Story——任一形态缺字段 / 变形 → 红；
 * - TS 形态不新增校验规则：值直接进 parseStory（与 JSON 同一函数，D-41「禁止第二套规则」）；
 * - DSL 形态不承载 story.id（归 project.json 清单，07 §三）→ 对比归一 id（与 T04-04 同口径）。
 */
import { describe, expect, it } from "vitest";
import type { Story } from "@lingfan/engine";
import { generateText, parseStory, parseTextStory } from "@lingfan/engine";
import storySource from "./fixtures/three-mode.story";

const canonical = parseStory(storySource);

describe("T09-03 三形态一致性互锁（锚点: three-mode-consistency）", () => {
  it("TS 源 ≡ JSON：同一形状逐字段深等；文本投影逐字节相同", () => {
    const fromJson = parseStory(
      JSON.parse(JSON.stringify(storySource)) as Story,
    );
    expect(fromJson).toEqual(canonical);
    expect(generateText(fromJson)).toBe(generateText(canonical));
  });

  it("TS 源 ≡ DSL：generateText ∘ parseTextStory 深等（story.id 归清单，对比归一）", () => {
    const reparsed = parseTextStory(generateText(canonical));
    expect({ ...reparsed, id: canonical.id }).toEqual(canonical);
  });

  it("JSON ≡ DSL（反向）：JSON 形态投影后重解析深等", () => {
    const fromJson = parseStory(
      JSON.parse(JSON.stringify(storySource)) as Story,
    );
    const reparsed = parseTextStory(generateText(fromJson));
    expect({ ...reparsed, id: fromJson.id }).toEqual(fromJson);
  });

  it("缺字段 fail-closed：任一形态缺 formatVersion → parseStory 整次拒绝", () => {
    const broken = JSON.parse(JSON.stringify(storySource)) as Record<
      string,
      unknown
    >;
    delete broken.formatVersion;
    expect(() => parseStory(broken as unknown as Story)).toThrow();
  });
});
