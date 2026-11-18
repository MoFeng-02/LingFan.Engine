/**
 * 选择层文案双轨：译文（translate 查表）优先，未命中回落缺省文案/宿主覆盖句。
 *
 * 查表函数按引擎 translate 的契约替身实现：命中给译文、未命中返回原文——
 * 「未命中回落」正是靠这条契约成立，不需要视图自己做任何判空。
 */
import { describe, expect, it, vi } from "vitest";

import {
  choicesLayerView,
  type ChoicesRenderInput,
} from "../../../packages/ui/src/overlay/choices-view";

/** 输入等待形态的最小渲染态 */
function inputWaiting(): ChoicesRenderInput {
  return {
    waiting: "input",
    menuPrompt: "",
    menuOptions: [],
    inputPrompt: "你叫什么名字？",
    inputCandidates: [{ text: "阿帆", value: "阿帆" }],
  };
}

/** 契约替身：译文表命中给译文，未命中返回原文（同引擎 translate） */
function fakeTranslate(table: ReadonlyMap<string, string>) {
  return vi.fn((text: string): string => table.get(text) ?? text);
}

describe("输入提交按钮文案：双轨", () => {
  it("不传任何注入时保持内建缺省「确定」（旧行为不变）", () => {
    const view = choicesLayerView(inputWaiting());
    expect(view?.input?.submitText).toBe("确定");
  });

  it("译文命中时用译文（overlay 优先于缺省文案）", () => {
    const translate = fakeTranslate(new Map([["确定", "OK"]]));
    const view = choicesLayerView(inputWaiting(), { translate });
    expect(view?.input?.submitText).toBe("OK");
    expect(translate).toHaveBeenCalledWith("确定");
  });

  it("译文未命中时回落缺省文案（引擎返回原文即天然回落）", () => {
    const translate = fakeTranslate(new Map([["别的句子", "Other"]]));
    const view = choicesLayerView(inputWaiting(), { translate });
    expect(view?.input?.submitText).toBe("确定");
    expect(translate).toHaveBeenCalledWith("确定");
  });

  it("宿主覆盖句（旧键）仍是回落基准：未命中时给覆盖句而非缺省", () => {
    const translate = fakeTranslate(new Map());
    const view = choicesLayerView(inputWaiting(), {
      translate,
      texts: { inputSubmit: "提交" },
    });
    expect(view?.input?.submitText).toBe("提交");
    expect(translate).toHaveBeenCalledWith("提交");
  });

  it("覆盖句本身也能被译文命中（查表作用于最终装配句）", () => {
    const translate = fakeTranslate(new Map([["提交", "Submit"]]));
    const view = choicesLayerView(inputWaiting(), {
      translate,
      texts: { inputSubmit: "提交" },
    });
    expect(view?.input?.submitText).toBe("Submit");
  });

  it("只传覆盖句不传查表时行为与旧版全同", () => {
    const view = choicesLayerView(inputWaiting(), {
      texts: { inputSubmit: "提交" },
    });
    expect(view?.input?.submitText).toBe("提交");
  });

  it("双轨不影响输入形态其余字段（prompt/候选原样透传）", () => {
    const view = choicesLayerView(inputWaiting(), {
      translate: fakeTranslate(new Map([["确定", "OK"]])),
    });
    expect(view?.input?.prompt).toBe("你叫什么名字？");
    expect(view?.input?.candidates).toEqual([{ label: "阿帆", value: "阿帆" }]);
  });
});

describe("菜单形态不受双轨影响", () => {
  it("菜单选项文本不经查表（故事文本由引擎读口给译文）", () => {
    const translate = fakeTranslate(new Map([["向左走", "Go left"]]));
    const view = choicesLayerView(
      {
        waiting: "menu",
        menuPrompt: "往哪走？",
        menuOptions: [{ text: "向左走", target: "left" }],
        inputPrompt: "",
      },
      { translate },
    );
    expect(view?.options[0]?.label).toBe("向左走");
    expect(translate).not.toHaveBeenCalled();
    expect(view?.input).toBeNull();
  });

  it("非等待态整层隐藏", () => {
    const view = choicesLayerView({ ...inputWaiting(), waiting: "none" });
    expect(view).toBeNull();
  });
});
