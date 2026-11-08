/**
 * 三个问题的答案合成。
 *
 * 为什么要独立成文件：答案不是「问一遍」的结果，而是三处来源按固定优先级叠出来的
 * ——命令行参数 > 交互问答 > 模板缺省。三者的优先级、跳过的时机、非交互终端怎么
 * 收场，都是同一件事的不同侧面，散在流程里就会各自漂移。
 *
 * 顺序固定为 工程名 → 描述 → 形态，且**已给出的项跳过、剩余项保持原顺序**：
 * 名字决定目录与包名，描述与形态是「这个工程」之上的补充；把顺序交给问答脚本，
 * 使用者就得跟着脚本的节奏改口。
 *
 * 形态用一次多选而不是三次单选：可叠加的层是一张网（选 Vue 就排除小程序，桌面壳
 * 又与小程序互斥），逐维度问会把矛盾留到最后才暴露。
 */
import {
  isValidProjectName,
  normalizeDescription,
  suggestProjectName,
} from "../shared/index.ts";
import {
  selectableLayers,
  type TemplateMeta,
  type TemplateOption,
} from "../registry/index.ts";
import {
  askDescription,
  askLayers,
  askProjectName,
  type PromptIo,
  type PromptTexts,
} from "./prompts.ts";

/** 合成答案所需的参数面：只认本文件要用的字段，不依赖命令行类型 */
export interface AnswerSources {
  readonly projectName?: string;
  readonly description?: string;
  readonly template?: string;
  readonly framework?: string;
  readonly shell?: string;
  readonly sources?: string;
  /** 全部取缺省、一个问题都不问 */
  readonly yes: boolean;
}

/**
 * 一次生成所需的全部答案。
 *
 * `description` 用空串表示「没有描述」：清单里因此不出现 `description` 键，
 * 而不是出现一个空字符串——两者在工具链里的语义不同，空串会被显示成一句空话。
 */
export interface CreateAnswers {
  readonly projectName: string;
  readonly description: string;
  readonly framework: string;
  readonly shell: string;
  readonly sources: string;
}

/** 合成答案需要的文案：问答提示语加上参数校验的失败措辞 */
export interface AnswerTexts extends PromptTexts {
  readonly frameworkUnknown: string;
  readonly shellUnknown: string;
  readonly sourcesUnknown: string;
  readonly templateMalformed: string;
}

/**
 * 按「参数 > 交互 > 缺省」合成答案；需要问却问不了时返回 undefined。
 *
 * 返回 undefined 的两种情形都已在这里把原因写给使用者：参数不合法（形态写法、
 * 未知层 id），以及非交互终端下仍有未指定的项。调用方只需把 undefined 转成
 * 退出码 1，不必重复判定。
 */
export async function resolveAnswers(input: {
  readonly args: AnswerSources;
  readonly meta: TemplateMeta;
  readonly templateRoot: string;
  readonly io: PromptIo | undefined;
  readonly texts: AnswerTexts;
}): Promise<CreateAnswers | undefined> {
  const { args, meta, texts } = input;
  // 形态先算：`--template` 写错时应当立刻失败，而不是先问完名字再告诉你写法不对。
  const preset = resolvePreset(input.args.template, meta, texts);
  if (preset === undefined) return undefined;
  const formGiven =
    args.template !== undefined ||
    args.framework !== undefined ||
    args.shell !== undefined ||
    args.sources !== undefined;

  const pending: string[] = [];
  if (args.projectName === undefined) pending.push(texts.promptProjectName);
  if (args.description === undefined) pending.push(texts.promptDescription);
  if (!formGiven) pending.push(texts.promptLayers);
  if (pending.length > 0 && input.io === undefined && !args.yes) {
    process.stderr.write(
      `${texts.nonInteractive}：${pending.join("、")}\n${texts.nonInteractiveHint}\n`,
    );
    return undefined;
  }

  const projectName = await resolveName(args, texts, input.io);
  if (projectName === undefined) return undefined;
  const description = await resolveDescription(args, texts, input.io);

  const form = formGiven
    ? resolvePinnedForm(args, preset, meta, texts)
    : await resolvePickedForm(input.templateRoot, meta, texts, input.io);
  if (form === undefined) return undefined;

  return { projectName, description, ...form };
}

/**
 * 工程名：参数优先且必须合法；参数缺席时取建议值，交互模式则问一次（打错重问）。
 *
 * 参数非法直接失败而不是退回问答：脚本里给了名字又给错，说明它预期这个名字生效，
 * 悄悄换一个名字生成出去比报错更糟。
 */
async function resolveName(
  args: AnswerSources,
  texts: AnswerTexts,
  io: PromptIo | undefined,
): Promise<string | undefined> {
  if (args.projectName !== undefined) {
    if (isValidProjectName(args.projectName)) return args.projectName;
    process.stderr.write(`${texts.nameInvalid}：${args.projectName}\n`);
    return undefined;
  }
  if (io === undefined) return suggestProjectName("");
  return await askProjectName(io, texts, undefined);
}

/**
 * 描述：参数优先，缺席则问一次；两处都按同一套归一处理。
 *
 * 参数给的描述也截断到上限：否则 `--description` 与交互输入的同一段文字会得到
 * 不同结果，而它们最终写进同一份清单。
 */
async function resolveDescription(
  args: AnswerSources,
  texts: AnswerTexts,
  io: PromptIo | undefined,
): Promise<string> {
  if (args.description !== undefined) {
    return normalizeDescription(args.description);
  }
  if (io === undefined) return "";
  return await askDescription(io, texts);
}

/**
 * 形态已由参数指定时的三维落位。
 *
 * 走的是「三维直接指定」的旧口头契约：任一维度缺席就取该维度首项，且**不做互斥
 * 校验**——调用方是脚本，它自己拼出来的组合要么本来合法，要么是在刻意生成异常
 * 样本。互斥校验只服务于问答，因为只有人会一次选到互相排斥的两层。
 */
function resolvePinnedForm(
  args: AnswerSources,
  preset: Preset,
  meta: TemplateMeta,
  texts: AnswerTexts,
): { framework: string; shell: string; sources: string } | undefined {
  const framework = pickKnown(
    args.framework ?? preset.framework,
    meta.frameworks,
    texts.frameworkUnknown,
  );
  if (framework === undefined) return undefined;
  const shell = pickKnown(
    args.shell ?? preset.shell,
    meta.shells,
    texts.shellUnknown,
  );
  if (shell === undefined) return undefined;
  const sources = pickKnown(
    args.sources ?? preset.sources,
    meta.sources,
    texts.sourcesUnknown,
  );
  if (sources === undefined) return undefined;
  return { framework, shell, sources };
}

/**
 * 形态靠问答决定时的三维落位：没选中该维度就取其首项。
 *
 * 判「可以选哪些层」用目录存在性而非 id 白名单：缺省层（`none`/`browser`/`ts`）
 * 没有目录，因此不出现在选项面，只作为「这一维没选」的落点。
 */
async function resolvePickedForm(
  templateRoot: string,
  meta: TemplateMeta,
  texts: AnswerTexts,
  io: PromptIo | undefined,
): Promise<{ framework: string; shell: string; sources: string } | undefined> {
  const layers = selectableLayers(templateRoot, meta);
  const picked =
    io === undefined ? [] : await askLayers(io, texts, layers, layers);
  const firstOf = (
    list: readonly TemplateOption[],
    invalidText: string,
  ): string | undefined => {
    const hit = list.find((option) => picked.includes(option.id)) ?? list[0];
    if (hit === undefined) {
      process.stderr.write(`${invalidText}\n`);
      return undefined;
    }
    return hit.id;
  };
  const framework = firstOf(meta.frameworks, texts.frameworkUnknown);
  if (framework === undefined) return undefined;
  const shell = firstOf(meta.shells, texts.shellUnknown);
  if (shell === undefined) return undefined;
  const sources = firstOf(meta.sources, texts.sourcesUnknown);
  if (sources === undefined) return undefined;
  return { framework, shell, sources };
}

/** 从一张表里取值：缺席取首项，取到却不在表里即报错 */
function pickKnown(
  value: string | undefined,
  options: readonly TemplateOption[],
  invalidText: string,
): string | undefined {
  const picked = value ?? options[0]?.id;
  if (picked !== undefined && options.some((option) => option.id === picked)) {
    return picked;
  }
  process.stderr.write(`${invalidText}：${String(picked)}\n`);
  return undefined;
}

/** `--template` 切出来的三维取值；缺席项为 undefined */
interface Preset {
  readonly framework?: string;
  readonly shell?: string;
  readonly sources?: string;
}

/**
 * 解析 `--template`：写作 `框架[-壳[-故事源]]`。
 *
 * 只做切分与「id 在该维度里」的校验，不参与互斥判断：它是给旧脚本的等价写法，
 * 语义与手工分三维给参数一致。
 */
function resolvePreset(
  template: string | undefined,
  meta: TemplateMeta,
  texts: AnswerTexts,
): Preset | undefined {
  if (template === undefined) return {};
  const parts = template.split("-").filter((part) => part !== "");
  if (parts.length === 0 || parts.length > 3) {
    process.stderr.write(`${texts.templateMalformed}：${template}\n`);
    return undefined;
  }
  const [framework, shell, sources] = parts;
  const known = (options: readonly TemplateOption[], id: string): boolean =>
    options.some((option) => option.id === id);
  if (!known(meta.frameworks, framework)) {
    process.stderr.write(`${texts.frameworkUnknown}：${framework}\n`);
    return undefined;
  }
  if (shell !== undefined && !known(meta.shells, shell)) {
    process.stderr.write(`${texts.shellUnknown}：${shell}\n`);
    return undefined;
  }
  if (sources !== undefined && !known(meta.sources, sources)) {
    process.stderr.write(`${texts.sourcesUnknown}：${sources}\n`);
    return undefined;
  }
  return { framework, shell, sources };
}
