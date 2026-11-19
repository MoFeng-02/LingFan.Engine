/**
 * op 负载 schema 全集：每条命令一个 `z.strictObject`，`.strict()` 拒绝未知字段
 * （编辑期 fail-closed）。字段面以执行器为权威（packages/core/src/runtime/ops/）。
 */
import { z } from "zod";
import { isValidSayColor } from "@lingfan-engine/core";
import type {
  AnimateBlockOpPayload,
  AnimateOpPayload,
  ArrayOpPayload,
  ArrayPopOpPayload,
  ArrayPushOpPayload,
  AssertOpPayload,
  AssignOpPayload,
  AudioChannelOpPayload,
  AudioPlayOpPayload,
  AudioSeekOpPayload,
  AudioStopOpPayload,
  AudioVolumeOpPayload,
  AutoSaveOpPayload,
  BackgroundOpPayload,
  BgSwitchOpPayload,
  BgmOpPayload,
  CallOpPayload,
  CharacterOpPayload,
  CutsceneOpPayload,
  DictOpPayload,
  DictSetOpPayload,
  EmptyOpPayload,
  ForOpPayload,
  ForeachOpPayload,
  FuncOpPayload,
  GuardOpPayload,
  HideOpPayload,
  IfOpPayload,
  InputOpPayload,
  InteractionOpPayload,
  JumpOpPayload,
  LoadOpPayload,
  MenuOpPayload,
  MinigameOpPayload,
  MountOpPayload,
  NavigateOpPayload,
  NotifyOpPayload,
  NvlOpPayload,
  PauseOpPayload,
  RandomOpPayload,
  ReturnOpPayload,
  SaveDeleteOpPayload,
  SaveOpPayload,
  SayOpPayload,
  SeOpPayload,
  SeekVideoOpPayload,
  ShakeOpPayload,
  ShowOpPayload,
  StopOpPayload,
  StyleOpPayload,
  SwitchOpPayload,
  TextTypewriterOpPayload,
  TransitionOpPayload,
  UncharacterOpPayload,
  UndefOpPayload,
  VideoOpPayload,
  VideoSkipableOpPayload,
  VoiceOpPayload,
  WaitOpPayload,
  WhileOpPayload,
  WindowOpPayload,
  ZindexOpPayload,
} from "@lingfan-engine/core/script";
import {
  Body,
  Fade,
  Finite,
  InstanceZ,
  NonEmpty,
  SlotName,
  StateValue,
  Value,
} from "./fragments.ts";

const saySchema = z.strictObject({
  text: NonEmpty,
  speaker: z.string().optional(),
  /**
   * 说话人颜色覆盖（覆盖整句/说话人）。
   *
   * **判据直接复用引擎的 `isValidSayColor`**（不在此重写正则）——
   * 两处各写一份判据 ⇒ 必然漂移——
   * 判据只此一份，投影/校验读同一份。
   * 与**行内标记** `{color=…}`（写在文本内部）是两件事。
   */
  color: z
    .string()
    .refine(isValidSayColor, {
      message: "必须为十六进制颜色（如 #FFD700 / #888 / #FFD700CC）",
    })
    .optional(),
  /**
   * 本句字体（字体名 = Resources/Fonts 文件名去扩展名）。
   * 名字是否在注册表内不在此校验（schema 看不见资源目录）——构建期 fail-closed +
   * 运行期渲染闸门回退负责，这里只收非空字符串。
   */
  font: NonEmpty.optional(),
  clickable: z.boolean().optional(),
  noskip: z.boolean().optional(),
  instant: z.boolean().optional(),
  typewriter: z.number().optional(),
  voice: NonEmpty.optional(),
  template: NonEmpty.optional(),
  z: InstanceZ, // dialogue 层实例 z
}) satisfies z.ZodType<SayOpPayload>;

const menuSchema = z.strictObject({
  prompt: z.string().optional(),
  options: z.array(z.strictObject({ text: NonEmpty, target: NonEmpty })).min(1),
  z: InstanceZ, // choices 层实例 z
}) satisfies z.ZodType<MenuOpPayload>;

const inputSchema = z.strictObject({
  prompt: NonEmpty,
  store: NonEmpty,
  // 候选快捷值：显示文本 + 要填进 store 的值（与 menu 的 {text,target} 刻意不同名）
  options: z
    .array(z.strictObject({ text: NonEmpty, value: NonEmpty }))
    .optional(),
  z: InstanceZ, // choices 层实例 z
}) satisfies z.ZodType<InputOpPayload>;

const notifySchema = z.strictObject({
  text: NonEmpty,
  type: z.string().optional(),
  duration: z.number().optional(),
  z: InstanceZ, // notifications 层实例 z
}) satisfies z.ZodType<NotifyOpPayload>;

const nvlSchema = z.strictObject({
  mode: z.enum(["enter", "auto", "clear", "exit"]).optional(),
}) satisfies z.ZodType<NvlOpPayload>;

const characterSchema = z.strictObject({
  key: NonEmpty,
  name: z.string().optional(),
  color: z.string().optional(),
  size: z.string().optional(),
  font: z.string().optional(),
  textColor: z.string().optional(),
  screen: NonEmpty.optional(),
}) satisfies z.ZodType<CharacterOpPayload>;

const uncharacterSchema = z.strictObject({ key: NonEmpty }) satisfies z.ZodType<UncharacterOpPayload>;

const waitSchema = z.strictObject({
  seconds: z.number(),
  skipable: z.boolean().optional(),
}) satisfies z.ZodType<WaitOpPayload>;

const pauseSchema = z.strictObject({
  seconds: z.number(),
}) satisfies z.ZodType<PauseOpPayload>;

const randomSchema = z.strictObject({
  seed: z.number().int(),
  range: z.tuple([z.number(), z.number()]),
  var: NonEmpty,
}) satisfies z.ZodType<RandomOpPayload>;

const jumpSchema = z.strictObject({
  target: NonEmpty,
}) satisfies z.ZodType<JumpOpPayload>;

const navigateSchema = z.strictObject({
  path: NonEmpty,
  scene: NonEmpty.optional(),
}) satisfies z.ZodType<NavigateOpPayload>;

/** `call`：target 必填；`into` 为结果绑定名（ret 带值返回时声明成调用方局部变量，无带值 ret 则绑 `null`） */
const callSchema = z.strictObject({
  target: NonEmpty,
  args: z.array(Value).optional(),
  into: NonEmpty.optional(),
}) satisfies z.ZodType<CallOpPayload>;

const returnSchema = z.strictObject({
  value: Value.optional(),
}) satisfies z.ZodType<ReturnOpPayload>;
/** 函数定义：name/params/body 三者引擎均必填（`data/format/validate/blocks.ts` `case "func"`） */
const funcSchema = z.strictObject({
  name: NonEmpty,
  params: z.array(NonEmpty),
  body: Body,
}) satisfies z.ZodType<FuncOpPayload>;

const ifSchema = z.strictObject({
  cond: NonEmpty,
  then: Body,
  elif: z.array(z.strictObject({ cond: NonEmpty, then: Body })).optional(),
  else: Body.optional(),
}) satisfies z.ZodType<IfOpPayload>;

const whileSchema = z.strictObject({
  cond: NonEmpty,
  body: Body,
}) satisfies z.ZodType<WhileOpPayload>;

const assertSchema = z.strictObject({
  cond: NonEmpty,
  message: z.string().optional(),
}) satisfies z.ZodType<AssertOpPayload>;

const guardSchema = z.strictObject({
  fn: NonEmpty,
  /**
   * 原样**运输**的宿主参数：嵌套 JSON 合法（同 `minigame.config` 口径；运行期
   * `findJsonValueError` 兜底 JSON 安全）。值口径原则：**被求值的走 `Value`
   * （call args / reward / set），被运输的走 JSON**（guard args / minigame config）。
   */
  args: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<GuardOpPayload>;

const forSchema = z.strictObject({
  var: NonEmpty,
  in: NonEmpty,
  body: Body,
}) satisfies z.ZodType<ForOpPayload>;

const foreachSchema = z.strictObject({
  var: NonEmpty,
  key: NonEmpty,
  body: Body,
}) satisfies z.ZodType<ForeachOpPayload>;

const switchSchema = z.strictObject({
  on: NonEmpty,
  cases: z.array(z.strictObject({ value: Value, body: Body })).min(1),
  default: Body.optional(),
}) satisfies z.ZodType<SwitchOpPayload>;

const emptySchema = z.strictObject({}) satisfies z.ZodType<EmptyOpPayload>;

const assignSchema = z.strictObject({
  key: NonEmpty,
  value: StateValue,
}) satisfies z.ZodType<AssignOpPayload>;

const undefSchema = z.strictObject({ key: NonEmpty }) satisfies z.ZodType<UndefOpPayload>;

const arraySchema = z.strictObject({
  key: NonEmpty,
  items: z.array(StateValue),
  once: z.boolean().optional(),
}) satisfies z.ZodType<ArrayOpPayload>;

const arrayPushSchema = z.strictObject({ key: NonEmpty, value: StateValue }) satisfies z.ZodType<ArrayPushOpPayload>;

const arrayPopSchema = z.strictObject({ key: NonEmpty }) satisfies z.ZodType<ArrayPopOpPayload>;

const dictSchema = z.strictObject({
  key: NonEmpty,
  value: z.record(z.string(), StateValue),
  once: z.boolean().optional(),
}) satisfies z.ZodType<DictOpPayload>;

const dictSetSchema = z.strictObject({
  key: NonEmpty,
  field: NonEmpty,
  value: StateValue,
}) satisfies z.ZodType<DictSetOpPayload>;

const saveSchema = z.strictObject({
  slot: SlotName,
  title: z.string().optional(),
}) satisfies z.ZodType<SaveOpPayload>;

const loadSchema = z.strictObject({ slot: NonEmpty }) satisfies z.ZodType<LoadOpPayload>;

const autoSaveSchema = z.strictObject({
  enabled: z.boolean(),
}) satisfies z.ZodType<AutoSaveOpPayload>;

const saveDeleteSchema = z.strictObject({ slot: SlotName }) satisfies z.ZodType<SaveDeleteOpPayload>;

const playFields = {
  resource: NonEmpty,
  volume: Finite.optional(),
};
const bgmSchema = z.strictObject({
  ...playFields,
  loop: z.boolean().optional(),
  fade: Fade.optional(),
  restart: z.boolean().optional(),
}) satisfies z.ZodType<BgmOpPayload>;
const seSchema = z.strictObject({ ...playFields }) satisfies z.ZodType<SeOpPayload>;
const voiceSchema = z.strictObject({
  ...playFields,
  auto_stop: z.boolean().optional(),
  restart: z.boolean().optional(),
}) satisfies z.ZodType<VoiceOpPayload>;
const stopSchema = z.strictObject({ fade: Fade.optional() }) satisfies z.ZodType<StopOpPayload>;

/** 音频实例 id：与扩展 / 玩法系统同一条短 id 形态（引擎侧是唯一声明处，此处只校验形态） */
const AudioInstanceId = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,31}$/, "须为小写字母开头的短 id（1..32 位）");

const audioChannelSchema = z.enum(["bgm", "se", "ambient", "voice"]);

const audioPlaySchema = z.strictObject({
  inst: AudioInstanceId,
  channel: audioChannelSchema,
  resource: NonEmpty,
  volume: Finite.optional(),
  loop: z.boolean().optional(),
  fade: Fade.optional(),
  restart: z.boolean().optional(),
}) satisfies z.ZodType<AudioPlayOpPayload>;

const audioStopSchema = z.strictObject({
  inst: AudioInstanceId.optional(),
  fade: Fade.optional(),
}) satisfies z.ZodType<AudioStopOpPayload>;

// 目标恰好给一个：inst = 单实例；channel = 单通道（se 无持久态，执行期空操作）
const audioVolumeSchema = z
  .strictObject({
    inst: AudioInstanceId.optional(),
    channel: audioChannelSchema.optional(),
    volume: Finite,
  })
  .refine((v) => (v.inst === undefined) !== (v.channel === undefined), {
    message: "inst 与 channel 互斥（恰好给一个）",
  }) satisfies z.ZodType<AudioVolumeOpPayload>;

// channel 省略 = 全部常驻通道（se 除外），故是 optional 而非缺省成某个通道；
// inst 与 channel 互斥：给了 inst 就只作用单个实例
const audioPauseSchema = z
  .strictObject({
    channel: audioChannelSchema.optional(),
    inst: AudioInstanceId.optional(),
  })
  .refine((v) => !(v.inst !== undefined && v.channel !== undefined), {
    message: "inst 与 channel 互斥（恰好给一个）",
  }) satisfies z.ZodType<AudioChannelOpPayload>;

const audioResumeSchema = z
  .strictObject({
    channel: audioChannelSchema.optional(),
    inst: AudioInstanceId.optional(),
  })
  .refine((v) => !(v.inst !== undefined && v.channel !== undefined), {
    message: "inst 与 channel 互斥（恰好给一个）",
  }) satisfies z.ZodType<AudioChannelOpPayload>;

// 定位目标恰好给一个；seconds 非负有限；se 无定位语义（执行期空操作）
const audioSeekSchema = z
  .strictObject({
    inst: AudioInstanceId.optional(),
    channel: audioChannelSchema.optional(),
    seconds: z.number().finite().min(0),
  })
  .refine((v) => (v.inst === undefined) !== (v.channel === undefined), {
    message: "inst 与 channel 互斥（恰好给一个）",
  }) satisfies z.ZodType<AudioSeekOpPayload>;

const videoSchema = z.strictObject({
  ...playFields,
  loop: z.boolean().optional(),
  restart: z.boolean().optional(),
  z: InstanceZ, // video 层实例 z
}) satisfies z.ZodType<VideoOpPayload>;
const cutsceneSchema = z.strictObject({
  ...playFields,
  skipable: z.boolean().optional(),
  restart: z.boolean().optional(),
  z: InstanceZ, // video 层实例 z
}) satisfies z.ZodType<CutsceneOpPayload>;
const seekVideoSchema = z.strictObject({
  seconds: z.number().finite().min(0),
}) satisfies z.ZodType<SeekVideoOpPayload>;
const videoSkipableSchema = z.strictObject({ value: z.boolean() }) satisfies z.ZodType<VideoSkipableOpPayload>;

/** minigame：config 原样透传 UI（任意 JSON）；reward 键值数组（value 执行期求值 → 标量/{expr}） */
const minigameSchema = z.strictObject({
  game: NonEmpty,
  config: z.record(z.string(), z.unknown()).optional(),
  on_success: NonEmpty.optional(),
  on_fail: NonEmpty.optional(),
  reward: z.array(z.strictObject({ key: NonEmpty, value: Value })).optional(),
  z: InstanceZ, // minigame 层实例 z
}) satisfies z.ZodType<MinigameOpPayload>;

/** 外部玩法系统接管（与 minigame 同形；无 reward——那是小游戏专属语义） */
const interactionSchema = z.strictObject({
  system: NonEmpty,
  config: z.record(z.string(), z.unknown()).optional(),
  on_success: NonEmpty.optional(),
  on_fail: NonEmpty.optional(),
  z: InstanceZ, // 与 minigame 同层（外部系统整屏接管）
}) satisfies z.ZodType<InteractionOpPayload>;

// ====== 元素系统（元素增删改 + 表现类）======
// 字段面以执行器为权威（runtime/ops/element/visual.ts 的 ELEMENT_OP_FIELDS）；x/y 允许数字或 CSS 长度串。

/** 元素增删改（`show` / `hide` / `background` / `bg_switch` / `zindex` / `style` / `window`） */
const showSchema = z.strictObject({
  target: NonEmpty,
  x: z.union([Finite, z.string()]).optional(),
  y: z.union([Finite, z.string()]).optional(),
  id: NonEmpty.optional(),
  name: NonEmpty.optional(),
  background: z.boolean().optional(),
}) satisfies z.ZodType<ShowOpPayload>;
const hideSchema = z.strictObject({ target: NonEmpty }) satisfies z.ZodType<HideOpPayload>;
const backgroundSchema = z.strictObject({ resource: NonEmpty }) satisfies z.ZodType<BackgroundOpPayload>;
const bgSwitchSchema = z.strictObject({ resource: NonEmpty }) satisfies z.ZodType<BgSwitchOpPayload>;
const zindexSchema = z.strictObject({ target: NonEmpty, value: Finite }) satisfies z.ZodType<ZindexOpPayload>;
const styleSchema = z.strictObject({
  target: NonEmpty,
  props: z.record(z.string(), Value),
}) satisfies z.ZodType<StyleOpPayload>;
const windowSchema = z.strictObject({ mode: z.enum(["auto", "show", "hide"]) }) satisfies z.ZodType<WindowOpPayload>;

/** 帧驱动表现类（`animate` / `animate_block` / `transition` / `shake` / `text_typewriter`） */
const animateSchema = z.strictObject({
  target: NonEmpty,
  property: NonEmpty,
  value: Finite,
  duration: Fade.optional(),
  easing: NonEmpty.optional(),
}) satisfies z.ZodType<AnimateOpPayload>;
const animateBlockSchema = z.strictObject({
  target: NonEmpty,
  x: Finite.optional(),
  y: Finite.optional(),
  opacity: Finite.optional(),
  rotation: Finite.optional(),
  scale: Finite.optional(),
  duration: Fade.optional(),
  easing: NonEmpty.optional(),
}) satisfies z.ZodType<AnimateBlockOpPayload>;
const transitionSchema = z.strictObject({
  type: NonEmpty,
  duration: Fade.optional(),
}) satisfies z.ZodType<TransitionOpPayload>;
const shakeSchema = z.strictObject({
  intensity: Finite.optional(),
  duration: Fade.optional(),
}) satisfies z.ZodType<ShakeOpPayload>;
const textTypewriterSchema = z.strictObject({
  enabled: z.boolean().optional(),
  speed: z.number().finite().positive().optional(),
}) satisfies z.ZodType<TextTypewriterOpPayload>;

/**
 * `mount`：挂载 / 卸载一个 UI 组件。
 *
 * `name` 是 UI 目录名（短标识：小写字母开头，其后小写字母 / 数字 / `_` / `-`，1..32 位）——
 * 与引擎侧 `UI_NAME_PATTERN` 同一形态，名字同时是产物键与目录名，两处必须一致。
 * `props` 只收对象；键值是否 JSON 安全由运行期写入点判定（schema 看不见值语义）。
 */
const mountSchema = z.strictObject({
  name: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,31}$/, "UI 名须小写字母开头，其后小写字母/数字/_/-，1..32 位"),
  visible: z.boolean(),
  props: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<MountOpPayload>;

export {
  saySchema,
  menuSchema,
  inputSchema,
  notifySchema,
  nvlSchema,
  characterSchema,
  uncharacterSchema,
  waitSchema,
  pauseSchema,
  randomSchema,
  jumpSchema,
  navigateSchema,
  callSchema,
  returnSchema,
  funcSchema,
  ifSchema,
  whileSchema,
  assertSchema,
  guardSchema,
  forSchema,
  foreachSchema,
  switchSchema,
  emptySchema,
  assignSchema,
  undefSchema,
  arraySchema,
  arrayPushSchema,
  arrayPopSchema,
  dictSchema,
  dictSetSchema,
  saveSchema,
  loadSchema,
  autoSaveSchema,
  saveDeleteSchema,
  bgmSchema,
  seSchema,
  voiceSchema,
  stopSchema,
  audioPlaySchema,
  audioStopSchema,
  audioVolumeSchema,
  audioPauseSchema,
  audioResumeSchema,
  audioSeekSchema,
  videoSchema,
  cutsceneSchema,
  seekVideoSchema,
  videoSkipableSchema,
  minigameSchema,
  interactionSchema,
  showSchema,
  hideSchema,
  backgroundSchema,
  bgSwitchSchema,
  zindexSchema,
  styleSchema,
  windowSchema,
  animateSchema,
  animateBlockSchema,
  transitionSchema,
  shakeSchema,
  textTypewriterSchema,
  mountSchema,
};
