/**
 * 降级打开（#11）**合成清单**判据测试：纯函数多方位。
 *
 * 语义：缺 `project.json` 时合成最小清单（formatVersion=1 / id=资源根名 /
 * entry=路径码元序第一个列）。只降级「缺失」这一种；坏故事文件跳过采集
 * （与组装器同口径，坏文件由组装器整次拒绝），**零可解析列 ⇒ fail-closed**。
 */
import { describe, expect, it } from "vitest";
import {
  assembleProject,
  ProjectAssemblyError,
  synthesizeDegradedManifest,
} from "@lingfan/engine";

const ATOMIC = (id: string, text: string) =>
  JSON.stringify({ formatVersion: 1, id, kind: "flow", commands: [{ op: "say", text }] });
const MULTI = JSON.stringify({
  formatVersion: 1,
  columns: [
    { id: "chapter1_start", kind: "flow", commands: [{ op: "say", text: "开场" }] },
    { id: "chapter1_end", kind: "flow", commands: [{ op: "say", text: "终" }] },
  ],
});

describe("synthesizeDegradedManifest · 合成判据", () => {
  it("确定性：entry = **路径码元序第一个列**（不随 Map 构造顺序漂移）", () => {
    const files = new Map<string, string>([
      ["Stories/zz.json", ATOMIC("zz_last", "尾")],
      ["Stories/aa/alpha.json", ATOMIC("alpha_first", "首")],
      ["Stories/mm.json", MULTI],
    ]);
    const { degraded } = synthesizeDegradedManifest("Demo", files);
    expect(degraded.entry).toBe("alpha_first"); // aa/ < mm.json < zz.json
  });

  it("合成清单能被组装器原样接受（入口存在性校验通过）", () => {
    const files = new Map<string, string>([["Stories/start.json", ATOMIC("start", "甲")]]);
    const { manifest } = synthesizeDegradedManifest("Demo", files);
    const story = assembleProject(manifest, files);
    expect(story.entry).toBe("start");
    expect(story.id).toBe("Demo"); // id 兜底 = 资源根名
  });

  it("多列文件：第一个列是该文件的**文件序首列**（chapter1_start 在 chapter1_end 前）", () => {
    const files = new Map<string, string>([["Stories/chapter1.story", MULTI]]);
    expect(synthesizeDegradedManifest("D", files).degraded.entry).toBe("chapter1_start");
  });

  it("🔴 坏故事文件**跳过采集**（与组装器同口径；坏了由组装器 issues 整次拒绝）", () => {
    const files = new Map<string, string>([
      ["Stories/broken.json", "{ 纯属坏档"],
      ["Stories/good.json", ATOMIC("good", "好")],
    ]);
    expect(synthesizeDegradedManifest("D", files).degraded.entry).toBe("good");
  });

  it("🔴 零可解析列 ⇒ fail-closed（ProjectAssemblyError，不合成空壳清单）", () => {
    const files = new Map<string, string>([["Stories/broken.json", "{ 纯属坏档"]]);
    expect(() => synthesizeDegradedManifest("D", files)).toThrow(ProjectAssemblyError);
  });

  it("回执 reason 含入口 id（显式告知的文案面，可直上状态栏 title）", () => {
    const files = new Map<string, string>([["Stories/start.json", ATOMIC("start", "甲")]]);
    const { degraded } = synthesizeDegradedManifest("Demo", files);
    expect(degraded.reason).toContain("project.json");
    expect(degraded.reason).toContain("start");
  });
});
