/**
 * 宿主项目默认字体判定（apps/playground/src/host/assets/app-fonts 的 defaultFontIssue）两端判别：
 * 项目未声明（undefined）= 不应用；字体名在注册表 = 通过；未注册 = 判定失败并携带
 * 面向作者的消息。开发态抛错 / 生产态告警回退的环境分派留在 applyDefaultFont（依赖
 * import.meta.env 与 DOM），本文件只锚判定本身——判定是两态语义的单点。
 *
 * virtual:story-fonts 是 Vite 构建期虚拟模块，vitest 里以桩替身导入（空清单）：
 * 被测判定只消费「注册表里有哪些名字」，桩清单为空即代表未注册的最小环境。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("virtual:story-fonts", () => ({ storyFonts: [] }));

import { defaultFontIssue } from "../../apps/playground/src/host/assets/app-fonts";

describe("宿主项目默认字体判定（defaultFontIssue）", () => {
  it("未声明（undefined）= 不应用，直接通过", () => {
    expect(defaultFontIssue(undefined, [])).toBeNull();
  });

  it("字体名在注册表 = 通过", () => {
    expect(defaultFontIssue("楷体", ["楷体", "宋体"])).toBeNull();
  });

  it("未注册字体名 = 判定失败，消息指明字体名、注册来源与两条修复路径", () => {
    const issue = defaultFontIssue("黑体", ["楷体"]);
    expect(issue).toContain('"黑体"');
    expect(issue).toContain("未在 Resources/Fonts 注册");
    expect(issue).toContain("PROJECT_DEFAULT_FONT");
  });
});
