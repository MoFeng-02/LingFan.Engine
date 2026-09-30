/**
 * op 全集 schema（Zod 单一事实源）：一份定义同时驱动属性面板表单派生与
 * 编辑期 fail-closed 校验。字段面以执行器为权威（packages/engine/src/runtime/engine.ts）：
 * 未知 op / 未知负载字段 / 缺失必填 / 类型错误在编辑期标红，错误不过夜。
 * 块体字段（then/body/…）按 z.unknown() 数组承载——嵌套命令的校验与指针定位由
 * validateStory 沿表单描述符递归（嵌套命令才拿得到逐条 unknown-op 诊断）。
 */

import { z } from "zod";
import type { Diagnostic } from "../contracts";
import { escapePointerToken } from "../contracts";

const NonEmpty = z.string().min(1);
const SlotName = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "槽位名必须为字母数字/_/-，1..64");
const Value = z.union([z.string(), z.number(), z.boolean()]);
const Body = z.array(z.unknown());
const Finite = z.number().finite();
const Fade = z.number().finite().min(0);
/** 实例级 z：非负有限数；仅拥有独立渲染层的命令接受 */
const InstanceZ = z.number().finite().min(0).optional();

const saySchema = z.strictObject({
  text: NonEmpty,
  speaker: z.string().optional(),
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
/** 函数定义：name/params/body 三者引擎均必填（format.ts `case "func"`） */
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

// ====== 元素系统（元素增删改 + 表现类）======
// 字段面以执行器为权威（engine.ts 的 ELEMENT_OP_FIELDS）；x/y 允许数字或 CSS 长度串。

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

/** op → 负载 schema（不含 op 键本身）；新增 op = 加条目 = 表单与校验自动出现 */
export const OP_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  say: saySchema,
  menu: menuSchema,
  input: inputSchema,
  notify: notifySchema,
  nvl: nvlSchema,
  character: characterSchema,
  wait: waitSchema,
  pause: pauseSchema,
  random: randomSchema,
  jump: jumpSchema,
  navigate: navigateSchema,
  func: funcSchema,
  call: callSchema,
  return: returnSchema,
  if: ifSchema,
  while: whileSchema,
  for: forSchema,
  foreach: foreachSchema,
  switch: switchSchema,
  break: emptySchema,
  continue: emptySchema,
  set: assignSchema,
  define: assignSchema,
  let: assignSchema,
  local: assignSchema,
  undef: undefSchema,
  array: arraySchema,
  array_push: arrayPushSchema,
  array_pop: arrayPopSchema,
  dict: dictSchema,
  dict_set: dictSetSchema,
  save: saveSchema,
  load: loadSchema,
  auto_save: autoSaveSchema,
  save_delete: saveDeleteSchema,
  bgm: bgmSchema,
  stop_bgm: stopSchema,
  se: seSchema,
  ambient: bgmSchema,
  stop_ambient: stopSchema,
  voice: voiceSchema,
  stop_voice: stopSchema,
  video: videoSchema,
  cutscene: cutsceneSchema,
  seek_video: seekVideoSchema,
  pause_video: emptySchema,
  resume_video: emptySchema,
  stop_video: emptySchema,
  video_skipable: videoSkipableSchema,
  minigame: minigameSchema,
  // 元素系统
  show: showSchema,
  hide: hideSchema,
  background: backgroundSchema,
  bg_switch: bgSwitchSchema,
  zindex: zindexSchema,
  style: styleSchema,
  window: windowSchema,
  animate: animateSchema,
  animate_block: animateBlockSchema,
  transition: transitionSchema,
  shake: shakeSchema,
  text_typewriter: textTypewriterSchema,
};

function issueToDiagnostic(
  issue: z.core.$ZodIssue,
  basePointer: string,
  op: string,
): Diagnostic {
  const segments = issue.path.map((seg) => escapePointerToken(String(seg)));
  const pointer =
    segments.length > 0 ? `${basePointer}/${segments.join("/")}` : basePointer;
  if (issue.code === "unrecognized_keys") {
    const keys =
      "keys" in issue && Array.isArray(issue.keys)
        ? issue.keys.map(String).join(", ")
        : issue.message;
    return {
      code: "unknown-field",
      severity: "error",
      message: `${op} 未知负载字段：${keys}（编辑期 fail-closed）`,
      pointer,
      op,
    };
  }
  const received = (issue as { received?: unknown }).received;
  if (
    issue.code === "invalid_type" &&
    (received === undefined || received === "undefined")
  ) {
    return {
      code: "missing-required",
      severity: "error",
      message: `${op}${issue.path.length > 0 ? `.${issue.path.join(".")}` : ""} 必填`,
      pointer,
      op,
    };
  }
  return {
    code: "invalid-value",
    severity: "error",
    message: `${op}${issue.path.length > 0 ? `.${issue.path.join(".")}` : ""}：${issue.message}`,
    pointer,
    op,
  };
}

/**
 * 编辑期单命令 fail-closed 校验（结构层）：未知 op / 未知字段 / 缺必填 / 类型错。
 * pointer = 命令对象自身在 Story 树上的 JSON Pointer。
 * `schemas`（可选）= op 负载 schema 面（缺省内建 OP_SCHEMAS；扩展注册后传合并集）。
 * 编辑期 fail-closed 校验的测试锚点见 validation.test。
 */
export function validateCommand(
  cmd: unknown,
  pointer = "",
  schemas: Readonly<Record<string, z.ZodType>> = OP_SCHEMAS,
): Diagnostic[] {
  if (typeof cmd !== "object" || cmd === null || Array.isArray(cmd)) {
    return [
      {
        code: "invalid-structure",
        severity: "error",
        message: "命令必须为对象",
        pointer,
      },
    ];
  }
  const op = (cmd as Record<string, unknown>).op;
  if (typeof op !== "string" || op === "") {
    return [
      {
        code: "invalid-structure",
        severity: "error",
        message: "命令必须为含非空 op 字符串的命令对象",
        pointer,
      },
    ];
  }
  const schema = schemas[op];
  if (schema === undefined) {
    return [
      {
        code: "unknown-op",
        severity: "error",
        message: `未知或未实现的命令：${op}`,
        pointer,
        op,
      },
    ];
  }
  const payload: Record<string, unknown> = {
    ...(cmd as Record<string, unknown>),
  };
  delete payload.op;
  const result = schema.safeParse(payload);
  if (result.success) return [];
  return result.error.issues.map((issue) =>
    issueToDiagnostic(issue, pointer, op),
  );
}
