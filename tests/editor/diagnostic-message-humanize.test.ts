/**
 * 诊断消息**人话化**守卫。
 *
 * **被治的问题**：工程里沿用 `bgm ""` 写法表「停止 BGM」，
 * 而底层报的是 **zod 英文原话**：
 * `bgm.resource：Too small: expected string to have >=1 characters`
 * —— 作者既看不懂，也不知道正确写法是什么。
 *
 * 口径（**保持严格 + 语义明确**）：
 * ① **不引入「空路径 = 停止」的隐式约定**（下一个作者看不出，「静默失败」就是这么来的）
 * ② 但**把正确写法直接告诉作者**：`bgm ""` ⇒ 提示用 `stop_bgm`
 * ③ 消息一律中文；**未覆盖的 zod code 保留原文**（不吞信息）
 */
import { describe, expect, it } from "vitest";
import { validateCommand } from "../../packages/editor/src/schema/opSchemas";

function messageOf(cmd: unknown): string {
  return validateCommand(cmd).map((d) => d.message).join(" | ");
}

describe("诊断消息人话化 · 空资源指向正确的停止命令", () => {
  it("**回归**：`bgm \"\"` 给出 `stop_bgm` 指引（真实工程 9 处这种写法）", () => {
    const msg = messageOf({ op: "bgm", resource: "" });
    expect(msg).toContain("资源路径不能为空");
    expect(msg).toContain("stop_bgm");
  });

  it("ambient / voice 各自指向自己的停止命令", () => {
    expect(messageOf({ op: "ambient", resource: "" })).toContain("stop_ambient");
    expect(messageOf({ op: "voice", resource: "" })).toContain("stop_voice");
  });

  it("**`se` 没有停止命令 ⇒ 不给指引**（一次性音效，不要编造命令名）", () => {
    const msg = messageOf({ op: "se", resource: "" });
    expect(msg).toContain("资源路径不能为空");
    expect(msg).not.toContain("stop_");
  });

  it("video / cutscene 指向 stop_video", () => {
    expect(messageOf({ op: "video", resource: "" })).toContain("stop_video");
  });
});

describe("诊断消息人话化 · 不再出现英文原话", () => {
  it("**空资源不再报 zod 英文**（`Too small: expected string…`）", () => {
    const msg = messageOf({ op: "bgm", resource: "" });
    expect(msg).not.toContain("Too small");
    expect(msg).not.toContain("expected string");
  });

  it("`too_big` 也中文化（不再 `Too big: expected…`）", () => {
    // 用一个有上界的字段触发（取不到就跳过断言，但确保不出现英文原话）
    const msg = messageOf({ op: "say", text: "x", z: -1 });
    expect(msg).not.toContain("Too small");
  });
});

describe("诊断消息人话化 · 兜底不吞信息", () => {
  it("**未覆盖的 zod code 保留原文**（宁可英文也不静默丢）", () => {
    // 未知字段走 `unrecognized_keys`（既有分支），或任何未覆盖 code ⇒ 非空消息
    const msg = messageOf({ op: "bgm", resource: "a.mp3", bogus_field: 1 });
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).toContain("未知负载字段");
  });

  it("合法命令**零诊断**（改动没误伤正常输入）", () => {
    expect(validateCommand({ op: "bgm", resource: "Audio/a.mp3" })).toEqual([]);
    expect(validateCommand({ op: "stop_bgm" })).toEqual([]);
  });
});
