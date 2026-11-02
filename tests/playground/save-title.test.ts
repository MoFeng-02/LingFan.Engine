/**
 * 示例工程的存档名规则：填了用填的、没填沿用旧名、没填且无旧名自动生成。
 *
 * 这套规则是创作侧口径（引擎只认 `title` 是个可选字符串），判据落在两处：
 * 三种输入各得其所，以及任何一种输入都不会返回空——宿主不该自己再补兜底，
 * 补法一散开，槽位列表里的名字就会一处有一处没有。
 */

import { describe, expect, it } from "vitest";
import {
  autoSaveTitle,
  resolveSaveTitle,
} from "../../apps/playground/src/host/panels/index.ts";

/** 固定时刻：2026-11-02 14:47 本地时间 */
const NOW = new Date(2026, 10, 2, 14, 47).getTime();

describe("autoSaveTitle：自动生成的存档名", () => {
  it("按月日时分生成", () => {
    expect(autoSaveTitle(NOW)).toBe("存档 11-02 14:47");
  });

  it("个位月份与个位日期补零，名字定长", () => {
    expect(autoSaveTitle(new Date(2026, 0, 5, 9, 3).getTime())).toBe(
      "存档 01-05 09:03",
    );
  });
});

describe("resolveSaveTitle：一次写盘该用的名字", () => {
  it("填了名字就用填的（改名走同一条路）", () => {
    expect(
      resolveSaveTitle({ typed: "客栈过夜", previous: "旧名字", now: NOW }),
    ).toBe("客栈过夜");
  });

  it("填的名字去掉两侧空白，纯空白视同没填", () => {
    expect(
      resolveSaveTitle({
        typed: "  客栈过夜  ",
        previous: undefined,
        now: NOW,
      }),
    ).toBe("客栈过夜");
    expect(
      resolveSaveTitle({ typed: "   ", previous: "旧名字", now: NOW }),
    ).toBe("旧名字");
  });

  it("没填但槽位原来有名字：沿用原名，覆盖存档不顺手抹名字", () => {
    expect(resolveSaveTitle({ typed: "", previous: "旧名字", now: NOW })).toBe(
      "旧名字",
    );
  });

  it("没填且原来没有名字：自动生成一个", () => {
    expect(resolveSaveTitle({ typed: "", previous: undefined, now: NOW })).toBe(
      "存档 11-02 14:47",
    );
  });

  it("旧名字是空串或纯空白：视同没有，走自动生成", () => {
    expect(resolveSaveTitle({ typed: "", previous: "", now: NOW })).toBe(
      "存档 11-02 14:47",
    );
    expect(resolveSaveTitle({ typed: "", previous: "  ", now: NOW })).toBe(
      "存档 11-02 14:47",
    );
  });
});
