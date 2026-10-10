/**
 * op 负载 schema 全集：每条命令一个 `z.strictObject`，`.strict()` 拒绝未知字段
 * （编辑期 fail-closed）。字段面以执行器为权威（packages/engine/src/runtime/ops/）。
 */
import { z } from "zod";
import { isValidSayColor } from "@lingfan/engine";
import {
  Body,
  Fade,
  Finite,
  InstanceZ,
  NonEmpty,
  SlotName,
  Value,
} from "./fragments";

const saySchema = z.strictObject({
  text: NonEmpty,
  speaker: z.string().optional(),
  /**
   * 说话人颜色覆盖（覆盖整句/说话人）。
   *
   * **判据直接复用引擎的 `isValidSayColor`**（不在此重写正则）——
   * 「两处各写一份判据 ⇒ 必然漂移」是本项目吃过的亏（`say color` 一度
   * 投影层放宽、校验层拒绝，正是两处不一致）。
   * 与**行内标记** `{color=…}`（写在文本内部）是两件事。
   */
  color: z
    .string()
    .refine(isValidSayColor, {
      message: "必须为十六进制颜色（如 #FFD700 / #888 / #FFD700CC）",
    })
    .optional(),
  clickable: z.boolean().optional(),
  noskip: z.boolean().optional(),
  instant: z.boolean().optional(),
  typewriter: z.number().optional(),
  voice: NonEmpty.optional(),
  template: NonEmpty.optional(),
  z: InstanceZ, // dialogue 层实例 z
});

const menuSchema = z.strictObject({
  prompt: z.string().optional(),
  options: z.array(z.strictObject({ text: NonEmpty, target: NonEmpty })).min(1),
  z: InstanceZ, // choices 层实例 z
});

const inputSchema = z.strictObject({
  prompt: NonEmpty,
  store: NonEmpty,
  z: InstanceZ, // choices 层实例 z
});

const notifySchema = z.strictObject({
  text: NonEmpty,
  type: z.string().optional(),
  duration: z.number().optional(),
  z: InstanceZ, // notifications 层实例 z
});

const nvlSchema = z.strictObject({
  mode: z.enum(["enter", "auto", "clear", "exit"]).optional(),
});

const characterSchema = z.strictObject({
  key: NonEmpty,
  name: z.string().optional(),
  color: z.string().optional(),
  size: z.string().optional(),
  font: z.string().optional(),
  textColor: z.string().optional(),
  screen: NonEmpty.optional(),
});

const waitSchema = z.strictObject({
  seconds: z.number(),
  skipable: z.boolean().optional(),
});

const pauseSchema = z.strictObject({
  seconds: z.number(),
});

const randomSchema = z.strictObject({
  seed: z.number().int(),
  range: z.tuple([z.number(), z.number()]),
  var: NonEmpty,
});

const jumpSchema = z.strictObject({
  target: NonEmpty,
});

const navigateSchema = z.strictObject({
  path: NonEmpty,
  scene: NonEmpty.optional(),
});

const callSchema = z.strictObject({
  target: NonEmpty,
  args: z.array(Value).optional(),
});

const returnSchema = z.strictObject({
  value: Value.optional(),
});
/** 函数定义：name/params/body 三者引擎均必填（`data/format/validate/blocks.ts` `case "func"`） */
const funcSchema = z.strictObject({
  name: NonEmpty,
  params: z.array(NonEmpty),
  body: Body,
});

const ifSchema = z.strictObject({
  cond: NonEmpty,
  then: Body,
  elif: z.array(z.strictObject({ cond: NonEmpty, then: Body })).optional(),
  else: Body.optional(),
});

const whileSchema = z.strictObject({
  cond: NonEmpty,
  body: Body,
});

const assertSchema = z.strictObject({
  cond: NonEmpty,
  message: z.string().optional(),
});

const guardSchema = z.strictObject({
  fn: NonEmpty,
  /**
   * 原样**运输**的宿主参数：嵌套 JSON 合法（同 `minigame.config` 口径；运行期
   * `findJsonValueError` 兜底 JSON 安全）。值口径原则：**被求值的走 `Value`
   * （call args / reward / set），被运输的走 JSON**（guard args / minigame config）。
   */
  args: z.record(z.string(), z.unknown()).optional(),
});

const forSchema = z.strictObject({
  var: NonEmpty,
  in: NonEmpty,
  body: Body,
});

const foreachSchema = z.strictObject({
  var: NonEmpty,
  key: NonEmpty,
  body: Body,
});

const switchSchema = z.strictObject({
  on: NonEmpty,
  cases: z.array(z.strictObject({ value: Value, body: Body })).min(1),
  default: Body.optional(),
});

const emptySchema = z.strictObject({});

const assignSchema = z.strictObject({ key: NonEmpty, value: Value });

const undefSchema = z.strictObject({ key: NonEmpty });

const arraySchema = z.strictObject({
  key: NonEmpty,
  items: z.array(Value),
  once: z.boolean().optional(),
});

const arrayPushSchema = z.strictObject({ key: NonEmpty, value: Value });

const arrayPopSchema = z.strictObject({ key: NonEmpty });

const dictSchema = z.strictObject({
  key: NonEmpty,
  value: z.record(z.string(), Value),
  once: z.boolean().optional(),
});

const dictSetSchema = z.strictObject({
  key: NonEmpty,
  field: NonEmpty,
  value: Value,
});

const saveSchema = z.strictObject({
  slot: SlotName,
  title: z.string().optional(),
});

const loadSchema = z.strictObject({ slot: NonEmpty });

const autoSaveSchema = z.strictObject({
  enabled: z.boolean(),
});

const saveDeleteSchema = z.strictObject({ slot: SlotName });

const playFields = {
  resource: NonEmpty,
  volume: Finite.optional(),
};
const bgmSchema = z.strictObject({
  ...playFields,
  loop: z.boolean().optional(),
  fade: Fade.optional(),
  restart: z.boolean().optional(),
});
const seSchema = z.strictObject({ ...playFields });
const voiceSchema = z.strictObject({
  ...playFields,
  auto_stop: z.boolean().optional(),
  restart: z.boolean().optional(),
});
const stopSchema = z.strictObject({ fade: Fade.optional() });

const videoSchema = z.strictObject({
  ...playFields,
  loop: z.boolean().optional(),
  z: InstanceZ, // video 层实例 z
});
const cutsceneSchema = z.strictObject({
  ...playFields,
  skipable: z.boolean().optional(),
  z: InstanceZ, // video 层实例 z
});
const seekVideoSchema = z.strictObject({
  seconds: z.number().finite().min(0),
});
const videoSkipableSchema = z.strictObject({ value: z.boolean() });

/** minigame：config 原样透传 UI（任意 JSON）；reward 键值数组（value 执行期求值 → 标量/{expr}） */
const minigameSchema = z.strictObject({
  game: NonEmpty,
  config: z.record(z.string(), z.unknown()).optional(),
  on_success: NonEmpty.optional(),
  on_fail: NonEmpty.optional(),
  reward: z.array(z.strictObject({ key: NonEmpty, value: Value })).optional(),
  z: InstanceZ, // minigame 层实例 z
});

/** 外部玩法系统接管（与 minigame 同形；无 reward——那是小游戏专属语义） */
const interactionSchema = z.strictObject({
  system: NonEmpty,
  config: z.record(z.string(), z.unknown()).optional(),
  on_success: NonEmpty.optional(),
  on_fail: NonEmpty.optional(),
  z: InstanceZ, // 与 minigame 同层（外部系统整屏接管）
});

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
});
const hideSchema = z.strictObject({ target: NonEmpty });
const backgroundSchema = z.strictObject({ resource: NonEmpty });
const bgSwitchSchema = z.strictObject({ resource: NonEmpty });
const zindexSchema = z.strictObject({ target: NonEmpty, value: Finite });
const styleSchema = z.strictObject({
  target: NonEmpty,
  props: z.record(z.string(), Value),
});
const windowSchema = z.strictObject({ mode: z.enum(["auto", "show", "hide"]) });

/** 帧驱动表现类（`animate` / `animate_block` / `transition` / `shake` / `text_typewriter`） */
const animateSchema = z.strictObject({
  target: NonEmpty,
  property: NonEmpty,
  value: Finite,
  duration: Fade.optional(),
  easing: NonEmpty.optional(),
});
const animateBlockSchema = z.strictObject({
  target: NonEmpty,
  x: Finite.optional(),
  y: Finite.optional(),
  opacity: Finite.optional(),
  rotation: Finite.optional(),
  scale: Finite.optional(),
  duration: Fade.optional(),
  easing: NonEmpty.optional(),
});
const transitionSchema = z.strictObject({
  type: NonEmpty,
  duration: Fade.optional(),
});
const shakeSchema = z.strictObject({
  intensity: Finite.optional(),
  duration: Fade.optional(),
});
const textTypewriterSchema = z.strictObject({
  enabled: z.boolean().optional(),
  speed: z.number().finite().positive().optional(),
});

export {
  saySchema,
  menuSchema,
  inputSchema,
  notifySchema,
  nvlSchema,
  characterSchema,
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
};
