/**
 * 问答交互的判据。
 *
 * 这里测的不是措辞而是行为：问了几次、撞上互斥之后还能不能靠一次重答走出来、
 * 以及标准输入已经关掉时会不会永远挂着。
 *
 * 最后一条是本文件最要紧的一条：`readline` 在输入流结束后只发 `close` 事件，
 * 它自己的 promise 既不 resolve 也不 reject，进程于是停在「等一个永远不会到的
 * 回车」上，只能靠外部超时收场。所以这里用一个已经结束的流把失败逼出来。
 */
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  askDescription,
  askLayers,
  createTerminalIo,
  findLayerConflicts,
  parseLayerAnswer,
  pickOption,
} from "../../../packages/create/src/cli/prompts.ts";
import type { PromptIo } from "../../../packages/create/src/cli/prompts.ts";
import { defaultCreateTexts } from "../../../packages/create/src/shared/texts.ts";
import {
  readTemplateMeta,
  resolveTemplateRoot,
  selectableLayers,
} from "../../../packages/create/src/registry/template-meta.ts";

const templateRoot = resolveTemplateRoot()!;
const meta = readTemplateMeta(templateRoot);
const layers = selectableLayers(templateRoot, meta);
const texts = defaultCreateTexts;

/** 按顺序吐出预置答案的问答面；答案用尽后一律返回空串 */
function scriptedIo(answers: readonly string[]): PromptIo {
  let index = 0;
  return {
    question: () => {
      const answer = answers[index] ?? "";
      index += 1;
      return Promise.resolve(answer);
    },
    close: () => undefined,
  };
}

describe("pickOption", () => {
  const options = [
    { id: "alpha", label: "甲", hint: "第一个" },
    { id: "beta", label: "乙", hint: "第二个" },
  ];

  it("序号从 1 起", () => {
    expect(pickOption(options, "1")).toBe("alpha");
    expect(pickOption(options, "2")).toBe("beta");
  });

  it("也认 id", () => {
    expect(pickOption(options, "beta")).toBe("beta");
  });

  it("空输入取首项", () => {
    expect(pickOption(options, "")).toBe("alpha");
  });

  it("越界与非数字都不认", () => {
    expect(pickOption(options, "3")).toBeUndefined();
    expect(pickOption(options, "0")).toBeUndefined();
    expect(pickOption(options, "gamma")).toBeUndefined();
  });

  it("空表上取首项返回 undefined 而不是抛", () => {
    expect(pickOption([], "")).toBeUndefined();
  });
});

describe("askDescription", () => {
  it("回车即空串", async () => {
    expect(await askDescription(scriptedIo([""]), texts)).toBe("");
  });

  it("普通描述原样返回", async () => {
    expect(await askDescription(scriptedIo(["试菜单用"]), texts)).toBe(
      "试菜单用",
    );
  });

  it("首尾空白去掉", async () => {
    expect(await askDescription(scriptedIo(["  两边有空格  "]), texts)).toBe(
      "两边有空格",
    );
  });

  it("超长截断到上限而不是报错", async () => {
    const answer = "长".repeat(260);
    expect(await askDescription(scriptedIo([answer]), texts)).toHaveLength(200);
  });

  it("只问一次：描述不重问", async () => {
    let asked = 0;
    const io: PromptIo = {
      question: () => {
        asked += 1;
        return Promise.resolve("");
      },
      close: () => undefined,
    };
    await askDescription(io, texts);
    expect(asked).toBe(1);
  });
});

describe("askLayers", () => {
  it("空输入即空集", async () => {
    expect(await askLayers(scriptedIo([""]), texts, layers, layers)).toEqual(
      [],
    );
  });

  it("序号按选项面落位", async () => {
    expect(await askLayers(scriptedIo(["1 3"]), texts, layers, layers)).toEqual(
      ["vue", "tauri"],
    );
  });

  it("认不出时重问一次即通过", async () => {
    const picked = await askLayers(
      scriptedIo(["99", "1"]),
      texts,
      layers,
      layers,
    );
    expect(picked).toEqual(["vue"]);
  });

  it("撞上互斥时重问，改答合法组合即通过", async () => {
    const picked = await askLayers(
      scriptedIo(["1 2", "1 3"]),
      texts,
      layers,
      layers,
    );
    expect(picked).toEqual(["vue", "tauri"]);
  });

  it("重问后改答空集也能通过", async () => {
    expect(
      await askLayers(scriptedIo(["1 2", ""]), texts, layers, layers),
    ).toEqual([]);
  });

  it("一直撞互斥时会一直重问，直到答出合法组合", async () => {
    const picked = await askLayers(
      scriptedIo(["1 2", "2 4", "3 4", "5"]),
      texts,
      layers,
      layers,
    );
    expect(picked).toEqual(["story"]);
  });
});

describe("createTerminalIo", () => {
  it("标准输入已关闭时 question 立即失败，而不是挂到超时", async () => {
    const input = new PassThrough();
    input.end();
    const io = createTerminalIo(input, new PassThrough());
    await expect(io.question("工程名：")).rejects.toThrow("标准输入已关闭");
    io.close();
  });

  it("问过一轮之后再问一次仍然失败", async () => {
    const input = new PassThrough();
    const io = createTerminalIo(input, new PassThrough());
    input.end();
    await expect(io.question("第一次：")).rejects.toThrow();
    await expect(io.question("第二次：")).rejects.toThrow();
    io.close();
  });

  it("有输入时正常返回该行", async () => {
    const input = new PassThrough();
    const io = createTerminalIo(input, new PassThrough());
    const pending = io.question("工程名：");
    input.write("my-story\n");
    await expect(pending).resolves.toBe("my-story");
    io.close();
  });
});

describe("parseLayerAnswer 与互斥推导的配套", () => {
  it("解析出的 id 能直接喂给互斥判断", () => {
    const picked = parseLayerAnswer(layers, "1 2")!;
    expect(findLayerConflicts(picked, layers)).toEqual([["vue", "react"]]);
  });
});
