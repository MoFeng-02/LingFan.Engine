/**
 * 工程名判据与版本区间的判据测试。
 *
 * 为什么值得单独钉住：工程名同时落进三处——目录名、`package.json` 的 `name`、
 * 清单里的 `id`，其中 `package.json` 的 `name` 在 npm 侧不接受大写与某些字符。
 * 生成之后再改名要动三处且可能已经装过依赖，所以在写盘之前就该拒绝。
 */
import { describe, expect, it } from "vitest";
import {
  caretRange,
  isValidProjectName,
  suggestProjectName,
} from "../../packages/create/src/shared/guards.ts";

describe("工程名判据", () => {
  it.each(["story", "my-story", "story_2", "9lives", "a"])(
    "接受合法名 %s",
    (name) => {
      expect(isValidProjectName(name)).toBe(true);
    },
  );

  it.each(["", "Story", "my story", "-leading", "_leading", "a/b", "有中文"])(
    "拒绝非法名 %s",
    (name) => {
      expect(isValidProjectName(name)).toBe(false);
    },
  );

  it("拒绝超过 64 字符的名字", () => {
    expect(isValidProjectName("a".repeat(64))).toBe(true);
    expect(isValidProjectName("a".repeat(65))).toBe(false);
  });

  it.each(["con", "aux", "nul", "com1", "lpt9"])(
    "拒绝 Windows 保留名 %s",
    (name) => {
      expect(isValidProjectName(name)).toBe(false);
    },
  );
});

describe("名字建议", () => {
  it("大写与空白折成短横线", () => {
    expect(suggestProjectName("My Story")).toBe("my-story");
  });

  it("去掉首尾短横线", () => {
    expect(suggestProjectName("  -hello-  ")).toBe("hello");
  });

  it("空输入给一个可用的缺省名", () => {
    expect(isValidProjectName(suggestProjectName(""))).toBe(true);
  });
});

describe("版本区间", () => {
  it("裸版本补上 caret", () => {
    expect(caretRange("0.1.3")).toBe("^0.1.3");
  });

  it("已带符号的原样保留", () => {
    expect(caretRange("^0.1.3")).toBe("^0.1.3");
    expect(caretRange("~0.1.3")).toBe("~0.1.3");
  });
});
