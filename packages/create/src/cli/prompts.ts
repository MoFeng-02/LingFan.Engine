/**
 * 交互问答。
 *
 * 生成器按固定顺序问三件事：工程名 → 描述 → 形态。顺序不能换：工程名决定目录与
 * 包名，描述与形态都是在「这个工程」之上的补充；先问后者再问名字，人得回头改口。
 *
 * 形态是**一次多选**而不是三个单选：可叠加的层是一张网，不是三根互不相干的轴——
 * 选 Vue 就排除了小程序，选桌面壳又与小程序互斥。逐个维度问会把矛盾留到最后才
 * 暴露，一次问清则当场说穿重问。
 *
 * 目标目录非空时另问一次怎么处置：那是覆盖别人的东西，必须由使用者当场表态，
 * 不能拿缺省值糊过去（缺省是取消）。
 *
 * 实现只用 `node:readline` 的 promise 版：它随 Node 自带，不引第三方交互库。
 * 提问写 stderr 而不是 stdout，这样 `npm create … > log.txt` 不会把问题一起吞掉。
 */
import { createInterface } from "node:readline/promises";
import {
  isValidProjectName,
  normalizeDescription,
  suggestProjectName,
} from "../shared/index.ts";
import type { LayerConflict, TemplateOption } from "../registry/index.ts";
import type { ExistingTarget } from "../generate/index.ts";

/** 问答需要的一份文案；由调用方从共享文案表传入，便于测试替换 */
export interface PromptTexts {
  readonly promptProjectName: string;
  readonly promptDescription: string;
  readonly descriptionHint: string;
  readonly promptLayers: string;
  readonly nonInteractive: string;
  readonly nonInteractiveHint: string;
  readonly promptExisting: string;
  readonly nameRequired: string;
  readonly nameInvalid: string;
  readonly layersEmptyHint: string;
  readonly layersInvalid: string;
  readonly layersConflict: string;
  readonly layersConflictHint: string;
  readonly existingIgnore: string;
  readonly existingIgnoreHint: string;
  readonly existingClear: string;
  readonly existingClearHint: string;
  readonly existingCancel: string;
  readonly existingCancelHint: string;
}

/** 问答依赖的输入输出面；默认接真实终端，测试可换成脚本化实现 */
export interface PromptIo {
  question(text: string): Promise<string>;
  close(): void;
}

/** 输入已关闭时的失败信息：调用方会把它印出来并退出，因此要人读得懂 */
const INPUT_CLOSED = "标准输入已关闭，无法继续问答";

/**
 * 造一个接到标准输入输出的问答面。
 *
 * 参数是为了可测：非交互终端下 `question()` 必须失败而不是永远挂着。`readline` 在
 * 输入流结束后只会发一个 `close` 事件，它自己的 promise 因此既不 resolve 也不
 * reject——进程于是停在「等一个永远不会到的回车」，靠外部超时才退出。这里把
 * `close` 转成 reject，让失败变成一次可捕获的异常。
 */
export function createTerminalIo(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stderr,
): PromptIo {
  const rl = createInterface({
    input,
    output,
    terminal: input === process.stdin && process.stdin.isTTY === true,
  });
  let closed = false;
  rl.once("close", () => {
    closed = true;
  });
  return {
    question: (text) => {
      if (closed) return Promise.reject(new Error(INPUT_CLOSED));
      return new Promise<string>((resolve, reject) => {
        const fail = (): void => reject(new Error(INPUT_CLOSED));
        rl.once("close", fail);
        rl.question(text).then(
          (answer) => {
            rl.off("close", fail);
            resolve(answer);
          },
          (error: unknown) => {
            rl.off("close", fail);
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      });
    },
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
 * 问描述：只问一次，回车即空。
 *
 * 不重问也不校验：描述只影响清单里的一行说明，不影响任何路径与命令。为难一个
 * 可以留空的输入框，只会让人多点几次回车。超长按上限截断——`package.json` 的
 * 描述在工具链里本就是短文本，与其被别处悄悄截，不如自己截。
 */
export async function askDescription(
  io: PromptIo,
  texts: PromptTexts,
): Promise<string> {
  const answer = await io.question(
    `${texts.promptDescription}（${texts.descriptionHint}）：`,
  );
  return normalizeDescription(answer);
}

/**
 * 问形态：一次多选，空格或逗号分隔，回车即空集。
 *
 * 选项表由调用方按「这一层有没有目录」筛过，所以这里看不到 `none`/`browser`/`ts`
 * 这类缺省层——它们不是一个可以叠加的东西，而是「什么都不叠」。
 *
 * 互斥对由元数据的 `excludes` 推导，本文件不认识任何具体层 id：新增一层只要在
 * 元数据里声明互斥，问答自动跟着变。撞上互斥就说穿是哪两层、然后重问同一问，
 * 不静默丢掉其中一层——丢掉会让「我明明选了小程序」无法解释。
 */
export async function askLayers(
  io: PromptIo,
  texts: PromptTexts,
  layers: readonly TemplateOption[],
  catalogue: readonly TemplateOption[],
): Promise<string[]> {
  const labels = new Map(catalogue.map((option) => [option.id, option.label]));
  const lines = layers
    .map((option, index) => {
      const excludes = (option.excludes ?? []).map(
        (id) => labels.get(id) ?? id,
      );
      const tail =
        excludes.length > 0 ? `  互斥：${excludes.join("、")}` : "  互斥：无";
      return `  ${index + 1}. ${option.label} —— ${option.hint}${tail}`;
    })
    .join("\n");
  process.stderr.write(`${texts.promptLayers}：\n${lines}\n`);
  for (;;) {
    const answer = (
      await io.question(
        `选择（1-${layers.length}，可多选，空格或逗号分隔；${texts.layersEmptyHint}）：`,
      )
    ).trim();
    const picked = parseLayerAnswer(layers, answer);
    if (picked === undefined) {
      process.stderr.write(`${texts.layersInvalid}\n`);
      continue;
    }
    const conflicts = findLayerConflicts(picked, catalogue);
    if (conflicts.length === 0) return picked;
    for (const [left, right] of conflicts) {
      process.stderr.write(
        `${texts.layersConflict}：${labels.get(left) ?? left} 与 ${labels.get(right) ?? right} 不能共存\n`,
      );
    }
    process.stderr.write(`${texts.layersConflictHint}：`);
  }
}

/**
 * 目标目录已存在且有内容时问怎么处置。
 *
 * 三项的顺序是「保留 → 清空 → 取消」，但**回车取的是取消**：前面的选项会改动
 * 磁盘上的既有文件，回车只是「没想好」，不该替使用者做破坏性决定。
 */
export async function askExisting(
  io: PromptIo,
  texts: PromptTexts,
): Promise<ExistingTarget> {
  const options: readonly TemplateOption[] = [
    {
      id: "ignore",
      label: texts.existingIgnore,
      hint: texts.existingIgnoreHint,
    },
    { id: "clear", label: texts.existingClear, hint: texts.existingClearHint },
    {
      id: "cancel",
      label: texts.existingCancel,
      hint: texts.existingCancelHint,
    },
  ];
  const lines = options
    .map((option, index) => `  ${index + 1}. ${option.label} —— ${option.hint}`)
    .join("\n");
  process.stderr.write(`${texts.promptExisting}：\n${lines}\n`);
  for (;;) {
    const answer = (
      await io.question(`选择（1-${options.length}，回车取消）：`)
    ).trim();
    if (answer === "") return "cancel";
    const picked = pickOption(options, answer);
    if (picked !== undefined) return picked as ExistingTarget;
    process.stderr.write(`${texts.promptExisting}：${answer}\n`);
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

/**
 * 把一次多选输入解析成层 id 列表，保序去重；有认不出的编号或名字时返回 undefined。
 *
 * 认两种写法（序号与 id）是为了脚本与手敲都顺手；认空格、半角逗号与全角逗号是因为
 * 中文输入法下逗号常常是全角的，为这个报错只会让人困惑。
 *
 * 空输入是空集而**不是**错误：不选任何层就是「只用骨架」，那是最常见的形态。
 */
export function parseLayerAnswer(
  layers: readonly TemplateOption[],
  answer: string,
): string[] | undefined {
  const tokens = answer
    .split(/[\s,，]+/)
    .map((token) => token.trim())
    .filter((token) => token !== "");
  if (tokens.length === 0) return [];
  const out: string[] = [];
  for (const token of tokens) {
    const picked = pickOptionStrict(layers, token);
    if (picked === undefined) return undefined;
    if (!out.includes(picked)) out.push(picked);
  }
  return out;
}

/**
 * 从选中的层里找出互斥对。
 *
 * 只看「选中的这两层彼此排斥」，不看谁先声明的：`excludes` 单边声明即生效，
 * 因此两边都写了也只算一对。
 */
export function findLayerConflicts(
  selected: readonly string[],
  catalogue: readonly TemplateOption[],
): LayerConflict[] {
  const chosen = new Set(selected);
  const seen = new Set<string>();
  const out: LayerConflict[] = [];
  for (const option of catalogue) {
    if (!chosen.has(option.id)) continue;
    for (const excluded of option.excludes ?? []) {
      if (!chosen.has(excluded)) continue;
      const key = [option.id, excluded].sort().join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([option.id, excluded]);
    }
  }
  return out;
}

/** 与 `pickOption` 同义，但不把空输入当首项：多选里空输入是「什么都不选」 */
function pickOptionStrict(
  options: readonly TemplateOption[],
  token: string,
): string | undefined {
  if (token === "") return undefined;
  const index = Number(token);
  if (Number.isInteger(index) && index >= 1 && index <= options.length) {
    return options[index - 1].id;
  }
  for (const option of options) {
    if (option.id === token) return option.id;
  }
  return undefined;
}
