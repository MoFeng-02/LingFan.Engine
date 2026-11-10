/**
 * 媒体填充词表 → CSS（UI 层映射）。
 *
 * 词表本身在契约里（`ELEMENT_FITS`），这里钉的是两列映射：
 * `<img>`/`<video>` 用 `object-fit`，背景 `div` 用 `background-size` + `background-position`。
 * 两列都必须覆盖每一个词——漏一个词的表现是「作者写了填充方式，画面按默认行为处理」，
 * 这种静默退化在真机上很难和「属性没生效」区分开。
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ELEMENT_FIT, ELEMENT_FITS } from "@lingfan-engine/core";
import type { ElementFit } from "@lingfan-engine/core";
import { fitBackgroundStyle, fitObjectStyle } from "@lingfan-engine/ui";

/** 作者数据里的脏值（运行期不校验值域，映射层必须自己兜住） */
const DIRTY: readonly unknown[] = [
  "",
  "COVER",
  "object-fit",
  "fill ",
  1,
  null,
  undefined,
];

describe("词表本身", () => {
  it("五个词、无重复、缺省词在其中", () => {
    expect(ELEMENT_FITS).toHaveLength(5);
    expect(new Set(ELEMENT_FITS).size).toBe(5);
    expect(ELEMENT_FITS).toContain(DEFAULT_ELEMENT_FIT);
  });

  it("缺省是 cover（铺满优先：留底色比裁边更破坏画面）", () => {
    expect(DEFAULT_ELEMENT_FIT).toBe("cover");
  });
});

describe("fitObjectStyle（object-fit 列）", () => {
  it("每个词都有非空 CSS 值（无 undefined、无空串）", () => {
    for (const fit of ELEMENT_FITS) {
      const value = fitObjectStyle(fit);
      expect(value, `fill=${fit}`).toBeTruthy();
      expect(typeof value).toBe("string");
    }
  });

  it("逐词对照（fill/contain/cover/none/scale-down 与 CSS 同名）", () => {
    expect(fitObjectStyle("fill")).toBe("fill");
    expect(fitObjectStyle("contain")).toBe("contain");
    expect(fitObjectStyle("cover")).toBe("cover");
    expect(fitObjectStyle("none")).toBe("none");
    expect(fitObjectStyle("scale-down")).toBe("scale-down");
  });

  it("脏值一律回退缺省词的映射（不抛、不返回空串）", () => {
    const fallback = fitObjectStyle(DEFAULT_ELEMENT_FIT);
    for (const raw of DIRTY) {
      expect(fitObjectStyle(raw as ElementFit), `raw=${String(raw)}`).toBe(
        fallback,
      );
    }
  });
});

describe("fitBackgroundStyle（background-size / background-position 列）", () => {
  it("每个词都有非空 size 与 position", () => {
    for (const fit of ELEMENT_FITS) {
      const style = fitBackgroundStyle(fit);
      expect(style.size, `fill=${fit}`).toBeTruthy();
      expect(style.position, `fill=${fit}`).toBeTruthy();
    }
  });

  it("逐词对照（背景侧 fill 要写成两轴 100%）", () => {
    expect(fitBackgroundStyle("fill")).toEqual({
      size: "100% 100%",
      position: "center",
    });
    expect(fitBackgroundStyle("contain")).toEqual({
      size: "contain",
      position: "center",
    });
    expect(fitBackgroundStyle("cover")).toEqual({
      size: "cover",
      position: "center",
    });
    expect(fitBackgroundStyle("none")).toEqual({
      size: "auto",
      position: "center",
    });
  });

  it("scale-down 退化为 auto：CSS 背景没有这个值", () => {
    expect(fitBackgroundStyle("scale-down").size).toBe("auto");
  });

  it("脏值一律回退缺省词的映射", () => {
    const fallback = fitBackgroundStyle(DEFAULT_ELEMENT_FIT);
    for (const raw of DIRTY) {
      expect(
        fitBackgroundStyle(raw as ElementFit),
        `raw=${String(raw)}`,
      ).toEqual(fallback);
    }
  });
});
