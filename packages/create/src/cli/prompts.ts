/**
 * 交互问答。
 *
 * 生成器要问四件事：工程名、框架、壳、故事源形态。四项都能用命令行参数预先给定——CI、
 * 脚本、或「我已经知道要什么」的人不该被问答拦住，因此问答只在参数缺席时发生。
 *
 * 实现只用 `node:readline` 的 promise 版：它随 Node 自带，不引第三方交互库。
 * 提问写 stderr 而不是 stdout，产物路径之类的结果才走 stdout，这样
 * `npm create … > log.txt` 不会把问题一起吞掉。
 */
import { createInterface } from "node:readline/promises";
import { isValidProjectName, suggestProjectName } from "../shared/index.ts";
import type { TemplateOption } from "../registry/index.ts";

/** 问答需要的一份文案；由调用方从共享文案表传入，便于测试替换 */
export interface PromptTexts {
  readonly promptProjectName: string;
  readonly promptFramework: string;
  readonly promptShell: string;
  readonly promptSources: string;
  readonly nameRequired: string;
  readonly nameInvalid: string;
  readonly frameworkUnknown: string;
  readonly shellUnknown: string;
  readonly sourcesUnknown: string;
}

/** 问答依赖的输入输出面；默认接真实终端，测试可换成脚本化实现 */
export interface PromptIo {
  question(text: string): Promise<string>;
  close(): void;
}

/** 造一个接到标准输入输出的问答面 */
export function createTerminalIo(): PromptIo {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: process.stdin.isTTY === true,
  });
  return {
    question: (text) => rl.question(text),
    close: () => rl.close(),
  };
}

/**
 * 问工程名：空输入取建议值，非法输入重问。
 *
 * 重问而不是直接失败，是因为这里是人机交互——打错一个字不该让整条命令重来，
 * 而失败退出只该发生在「参数模式」（调用方传了非法名字）下。
 */
export async function askProjectName(
  io: PromptIo,
  texts: PromptTexts,
  initial: string | undefined,
): Promise<string> {
  if (initial !== undefined) return initial;
  for (;;) {
    const answer = (await io.question(`${texts.promptProjectName}：`)).trim();
    const name = answer === "" ? suggestProjectName("") : answer;
    if (isValidProjectName(name)) return name;
    process.stderr.write(
      `${answer === "" ? texts.nameRequired : texts.nameInvalid}\n`,
    );
  }
}

/**
 * 从选项表里选一项：输入序号（从 1 起）或直接输入 id，空输入取首项。
 *
 * 两种取值都认，是因为脚本里写 `--framework vue` 更自然，而交互时按数字更省事；
 * 让同一套问答支持两种输入，参数模式与交互模式就不必分两套校验。
 */
export async function askOption(
  io: PromptIo,
  label: string,
  options: readonly TemplateOption[],
  fallbackId: string | undefined,
  invalidText: string,
): Promise<string> {
  if (fallbackId !== undefined) return fallbackId;
  const lines = options
    .map((option, index) => `  ${index + 1}. ${option.label} —— ${option.hint}`)
    .join("\n");
  process.stderr.write(`${label}：\n${lines}\n`);
  for (;;) {
    const answer = (
      await io.question(`选择（1-${options.length}，回车取 1）：`)
    ).trim();
    const picked = pickOption(options, answer);
    if (picked !== undefined) return picked;
    process.stderr.write(`${invalidText}\n`);
  }
}

/**
 * 把一次输入解析成选项 id；解析不出返回 undefined。
 *
 * 序号先判再判 id：`1` 与某个 id 恰好同名时，序号语义优先——用户看到的是编号表。
 */
export function pickOption(
  options: readonly TemplateOption[],
  answer: string,
): string | undefined {
  if (answer === "") {
    return options.length > 0 ? options[0].id : undefined;
  }
  const index = Number(answer);
  if (Number.isInteger(index) && index >= 1 && index <= options.length) {
    return options[index - 1].id;
  }
  for (const option of options) {
    if (option.id === answer) return option.id;
  }
  return undefined;
}
