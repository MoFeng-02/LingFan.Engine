/**
 * 三段问答合成的判据：参数 > 交互 > 缺省，且「已给出的项跳过、剩余项保序」。
 *
 * 为什么单独测这一层：这一层决定「使用者到底被问了几次、按什么顺序问」。
 * 顺序错了不会让任何一屏崩掉，只会让人在问答里先被问形态、再被问名字，
 * 于是一路回车回到原地——所以顺序必须由断言钉住，而不是靠读代码确认。
 *
 * 问答面用脚本化的假实现：真的开 readline 测不出「问了什么、问了几次」，
 * 而这个测试要的正是这两件事。
 */
import { describe, expect, it } from "vitest";
import { resolveAnswers } from "../../../packages/create/src/cli/answers.ts";
import type { PromptIo } from "../../../packages/create/src/cli/prompts.ts";
import { defaultCreateTexts } from "../../../packages/create/src/shared/texts.ts";
import {
  readTemplateMeta,
  resolveTemplateRoot,
} from "../../../packages/create/src/registry/template-meta.ts";

const templateRoot = resolveTemplateRoot()!;
const meta = readTemplateMeta(templateRoot);

/** 记录被问到的提示语，并按顺序吐出预置答案 */
function scriptedIo(answers: readonly string[]): {
  io: PromptIo;
  asked: string[];
} {
  const asked: string[] = [];
  let index = 0;
  const io: PromptIo = {
    question: (text) => {
      asked.push(text);
      const answer = answers[index] ?? "";
      index += 1;
      return Promise.resolve(answer);
    },
    close: () => undefined,
  };
  return { io, asked };
}

/** 一个拒绝被提问的问答面：用来证明「该跳过的项一次都没问」 */
const forbiddenIo: PromptIo = {
  question: () => Promise.reject(new Error("不该提问")),
  close: () => undefined,
};

describe("resolveAnswers", () => {
  it("参数齐全时一个问题都不问", async () => {
    const answers = await resolveAnswers({
      args: {
        projectName: "my-story",
        description: "一段描述",
        framework: "vue",
        shell: "tauri",
        sources: "ts",
        yes: false,
      },
      meta,
      templateRoot,
      io: forbiddenIo,
      texts: defaultCreateTexts,
    });
    expect(answers).toEqual({
      projectName: "my-story",
      description: "一段描述",
      framework: "vue",
      shell: "tauri",
      sources: "ts",
    });
  });

  it("只给了工程名时，按 描述 → 形态 的顺序问余下两项", async () => {
    const { io, asked } = scriptedIo(["", ""]);
    const answers = await resolveAnswers({
      args: { projectName: "my-story", yes: false },
      meta,
      templateRoot,
      io,
      texts: defaultCreateTexts,
    });
    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain(defaultCreateTexts.promptDescription);
    expect(asked[1]).toContain("可多选");
    expect(answers?.projectName).toBe("my-story");
  });

  it("给了形态参数时仍按 工程名 → 描述 问，顺序不因跳过而变化", async () => {
    const { io, asked } = scriptedIo(["my-story", ""]);
    await resolveAnswers({
      args: { framework: "react", yes: false },
      meta,
      templateRoot,
      io,
      texts: defaultCreateTexts,
    });
    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain(defaultCreateTexts.promptProjectName);
    expect(asked[1]).toContain(defaultCreateTexts.promptDescription);
  });

  it("只给了描述时，先问工程名、后问形态", async () => {
    const { io, asked } = scriptedIo(["my-story", ""]);
    const answers = await resolveAnswers({
      args: { description: "一段描述", yes: false },
      meta,
      templateRoot,
      io,
      texts: defaultCreateTexts,
    });
    expect(asked[0]).toContain(defaultCreateTexts.promptProjectName);
    expect(asked[1]).toContain("可多选");
    expect(answers?.description).toBe("一段描述");
  });

  it("空形态输入等于空集：三维各取首项", async () => {
    const { io } = scriptedIo(["my-story", "", ""]);
    const answers = await resolveAnswers({
      args: { yes: false },
      meta,
      templateRoot,
      io,
      texts: defaultCreateTexts,
    });
    expect(answers).toEqual({
      projectName: "my-story",
      description: "",
      framework: meta.frameworks[0].id,
      shell: meta.shells[0].id,
      sources: meta.sources[0].id,
    });
  });

  it("选中单个框架层时只换该维度", async () => {
    const { io } = scriptedIo(["my-story", "", "2"]);
    const answers = await resolveAnswers({
      args: { yes: false },
      meta,
      templateRoot,
      io,
      texts: defaultCreateTexts,
    });
    expect(answers?.framework).toBe("react");
    expect(answers?.shell).toBe(meta.shells[0].id);
    expect(answers?.sources).toBe(meta.sources[0].id);
  });

  it("多选跨维度时两个维度一起落位", async () => {
    const { io } = scriptedIo(["my-story", "", "1 3"]);
    const answers = await resolveAnswers({
      args: { yes: false },
      meta,
      templateRoot,
      io,
      texts: defaultCreateTexts,
    });
    expect(answers?.framework).toBe("vue");
    expect(answers?.shell).toBe("tauri");
  });

  it("回车取缺省：名字取建议值，描述为空串，形态空集", async () => {
    const { io } = scriptedIo(["", "", ""]);
    const answers = await resolveAnswers({
      args: { yes: false },
      meta,
      templateRoot,
      io,
      texts: defaultCreateTexts,
    });
    expect(answers?.projectName).toBe("lingfan-story");
    expect(answers?.description).toBe("");
  });

  it("参数给的描述与交互输入走同一套归一：超长截断、首尾空白去掉", async () => {
    const answers = await resolveAnswers({
      args: {
        projectName: "my-story",
        description: `  ${"长".repeat(240)}  `,
        framework: "none",
        shell: "browser",
        sources: "ts",
        yes: false,
      },
      meta,
      templateRoot,
      io: forbiddenIo,
      texts: defaultCreateTexts,
    });
    expect(answers?.description).toHaveLength(200);
  });

  it("全空白描述等于没有描述", async () => {
    const answers = await resolveAnswers({
      args: {
        projectName: "my-story",
        description: "   ",
        framework: "none",
        shell: "browser",
        sources: "ts",
        yes: false,
      },
      meta,
      templateRoot,
      io: forbiddenIo,
      texts: defaultCreateTexts,
    });
    expect(answers?.description).toBe("");
  });

  it("非交互终端且仍有待问项时失败，不问任何问题", async () => {
    const answers = await resolveAnswers({
      args: { yes: false },
      meta,
      templateRoot,
      io: undefined,
      texts: defaultCreateTexts,
    });
    expect(answers).toBeUndefined();
  });

  it("非交互终端但参数齐全时照常合成", async () => {
    const answers = await resolveAnswers({
      args: {
        projectName: "my-story",
        description: "",
        framework: "react",
        shell: "browser",
        sources: "story",
        yes: false,
      },
      meta,
      templateRoot,
      io: undefined,
      texts: defaultCreateTexts,
    });
    expect(answers).toEqual({
      projectName: "my-story",
      description: "",
      framework: "react",
      shell: "browser",
      sources: "story",
    });
  });

  it("`--yes` 全取缺省且一个问题都不问", async () => {
    const answers = await resolveAnswers({
      args: { yes: true },
      meta,
      templateRoot,
      io: undefined,
      texts: defaultCreateTexts,
    });
    expect(answers).toEqual({
      projectName: "lingfan-story",
      description: "",
      framework: meta.frameworks[0].id,
      shell: meta.shells[0].id,
      sources: meta.sources[0].id,
    });
  });

  it("参数非法时不退回问答，直接失败", async () => {
    const badName = await resolveAnswers({
      args: { projectName: "My Story", yes: true },
      meta,
      templateRoot,
      io: undefined,
      texts: defaultCreateTexts,
    });
    expect(badName).toBeUndefined();

    const badLayer = await resolveAnswers({
      args: { projectName: "my-story", framework: "svelte", yes: true },
      meta,
      templateRoot,
      io: undefined,
      texts: defaultCreateTexts,
    });
    expect(badLayer).toBeUndefined();
  });

  it("三维参数走直接指定：不做互斥校验", async () => {
    const answers = await resolveAnswers({
      args: {
        projectName: "my-story",
        description: "",
        framework: "vue",
        shell: "miniprogram",
        sources: "ts",
        yes: true,
      },
      meta,
      templateRoot,
      io: undefined,
      texts: defaultCreateTexts,
    });
    expect(answers?.framework).toBe("vue");
    expect(answers?.shell).toBe("miniprogram");
  });

  it("`--template` 切出三维，等价于分维度给参数", async () => {
    const viaTemplate = await resolveAnswers({
      args: { projectName: "my-story", template: "vue-tauri", yes: true },
      meta,
      templateRoot,
      io: undefined,
      texts: defaultCreateTexts,
    });
    const viaFlags = await resolveAnswers({
      args: {
        projectName: "my-story",
        framework: "vue",
        shell: "tauri",
        yes: true,
      },
      meta,
      templateRoot,
      io: undefined,
      texts: defaultCreateTexts,
    });
    expect(viaTemplate).toEqual(viaFlags);
    expect(viaTemplate?.framework).toBe("vue");
    expect(viaTemplate?.shell).toBe("tauri");
  });

  it("`--template` 写法不对时失败", async () => {
    const tooMany = await resolveAnswers({
      args: {
        projectName: "my-story",
        template: "vue-tauri-ts-extra",
        yes: true,
      },
      meta,
      templateRoot,
      io: undefined,
      texts: defaultCreateTexts,
    });
    expect(tooMany).toBeUndefined();
  });
});
