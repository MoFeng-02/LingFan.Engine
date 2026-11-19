/**
 * 对话与文本命令的执行：say / menu / wait / pause / nvl / character。
 *
 * 这一族是「等待型」命令的主体——写状态之后故事停在该处，等玩家点击、选择
 * 或定时器到点才继续。因此等待画面就是玩家看到的稳定画面，检查点落在这一处。
 */
import {
  SYS,
  type AudioChannelState,
  type CharacterDef,
  type StoryCommand,
} from "../../contracts/index.ts";
import {
  captureSource,
  recordInterpolation,
  updateSources,
} from "../i18n/index.ts";
import { armWaitTimer } from "../internal/index.ts";
import type { Frame, OpContext } from "../internal/index.ts";

/** say 的已知负载字段；未知字段 fail-closed */
const SAY_KNOWN_FIELDS = new Set([
  "op",
  "text",
  "speaker",
  // 说话人颜色覆盖（覆盖整句/说话人；与行内标记 `{color=…}` 是两件事）
  "color",
  // 本句字体（分辨链里比角色/列级更具体的一档；注册表校验在构建期，运行期由渲染层闸门兜底）
  "font",
  "clickable",
  "noskip",
  "instant",
  "typewriter",
  "voice",
  "template",
  "z", // 实例级 z（dialogue 层）
]);

/** 十六进制颜色（`#RGB` / `#RRGGBB` / `#RRGGBBAA`）——`say color` 的统一校验口径 */
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** `say color` 的校验（编辑器 schema 与本处同一口径；导出供编辑器复用，杜绝两处漂移） */
export function isValidSayColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_RE.test(value);
}

/** wait 的合法负载字段；出现集合外字段即 fail-closed（`wait-unknown-field`） */
const WAIT_FIELDS = new Set(["op", "seconds", "skipable"]);
/** pause 的合法负载字段（无 `skipable`：pause 恒为 hard）；集合外字段同样 fail-closed */
const PAUSE_FIELDS = new Set(["op", "seconds"]);

/** say：写对话系统键 → 进入 dialog 等待（文本先翻译后插值） */
export function execSay(ctx: OpContext, frame: Frame, cmd: StoryCommand): void {
  if (ctx.rejectBadInstanceZ(cmd)) return; // 先拒非法 z（不动状态）
  if (typeof cmd.text !== "string" || cmd.text === "") {
    ctx.fail("say-invalid", "say 负载必须有非空 text 字符串");
    return;
  }
  const unknownFields = Object.keys(cmd).filter(
    (k) => !SAY_KNOWN_FIELDS.has(k),
  );
  if (unknownFields.length > 0) {
    ctx.fail(
      "say-unknown-field",
      `say 未知负载字段：${unknownFields.join(", ")}`,
    );
    return;
  }
  if (
    cmd.template !== undefined &&
    (typeof cmd.template !== "string" || cmd.template === "")
  ) {
    ctx.fail(
      "say-invalid-template",
      "say.template 必须为非空字符串（模板注册名）",
    );
    return;
  }
  // `say color` 校验：只认十六进制，非法即拦。
  // 与编辑器 schema 同一判据（`isValidSayColor`）⇒ 杜绝「投影层放宽、校验层拒绝」
  // 这类两处漂移（同一功能两个口径是最忌的）。
  if (cmd.color !== undefined && !isValidSayColor(cmd.color)) {
    ctx.fail(
      "say-invalid-color",
      `say.color 必须为十六进制颜色（如 "#FFD700" / "#888" / "#FFD700CC"），收到 ${JSON.stringify(cmd.color)}`,
    );
    return;
  }
  // `say font` 校验：形状校验（非空字符串）。字体名是否在注册表内属构建期/渲染层闸门职责，
  // 引擎只保证「写进 SYS 的总是字符串」。
  if (
    cmd.font !== undefined &&
    (typeof cmd.font !== "string" || cmd.font === "")
  ) {
    ctx.fail(
      "say-invalid-font",
      `say.font 必须为非空字符串（字体名 = Resources/Fonts 文件名去扩展名），收到 ${JSON.stringify(cmd.font)}`,
    );
    return;
  }
  // 状态存原文 + 源：插值在原文模板上做，记录器捕获说话那一刻的实参；
  // 切语言用捕获实参重插值（画面只有语言变，语义不变）。行内标记 {b}{p} 原样透传；
  // 失败保留原文 + error。speaker 与 text 同语义插值——动态说话人（如 func 实参）
  // 经此获得真实名字；角色模板查表仍用插值后的原值。
  const { text, errors, source } = recordInterpolation(ctx, cmd.text);
  const speakerSrc = typeof cmd.speaker === "string" ? cmd.speaker : "";
  const {
    text: speakerText,
    errors: speakerErrors,
    source: speakerSource,
  } = recordInterpolation(ctx, speakerSrc);
  for (const e of [...errors, ...speakerErrors])
    ctx.fail(e.code, ctx.texts.interpolationFallback(e.message));
  // 源先于表面键写入：出站派生读「当时」的源；无说话人清其源
  updateSources(ctx, {
    dialog: source,
    speaker: speakerSrc === "" ? undefined : speakerSource,
  });

  // 竞态防护：进入等待前清上一句残留的完成标记（防双击/快速点击跳句）
  ctx.setSystem(SYS.dialogComplete, false);
  ctx.setSystem(SYS.currentDialogSpeaker, speakerText);
  // 说话人颜色覆盖（`say color="#888"`）：每句都写——
  // 缺省写空串 ⇒ 上一句的覆盖不会残留（与 `currentDialogSpeaker` 同一口径）。
  // UI 读法：`覆盖值 || character.color`（覆盖优先于角色定义）。
  ctx.setSystem(
    SYS.currentDialogColor,
    typeof cmd.color === "string" ? cmd.color : "",
  );
  // 模板三级优先级：
  // say template > character screen（按插值后说话人查表，与 UI 侧角色样式查表一致）> null(全局默认)
  const characterScreen = ctx.characters.get(speakerText)?.screen;
  ctx.setSystem(
    SYS.dialogTemplate,
    typeof cmd.template === "string" ? cmd.template : (characterScreen ?? null),
  );
  // 字体分辨链（最具体优先）：say 行参 > 角色字体（角色定义记录的上次字体）> 列级字体。
  // 每句都写、无声明写空串（与 currentDialogColor 同口径）⇒ 换列后上一列字体不残留；
  // 更具体的行内 {font=} 标记在渲染层生效，项目默认字体由宿主 CSS 变量承接。
  const column =
    frame.columnId === null ? undefined : ctx.columnById(frame.columnId);
  const resolvedFont =
    typeof cmd.font === "string"
      ? cmd.font
      : (ctx.characters.get(speakerText)?.font ?? column?.font ?? "");
  ctx.setSystem(SYS.dialogFont, resolvedFont);
  ctx.setSystem(SYS.currentDialogText, text);
  ctx.setSystem(SYS.dialogClickable, cmd.clickable === true);
  ctx.setSystem(SYS.dialogNoskip, cmd.noskip === true);
  ctx.setInstanceZ(SYS.dialogueZ, cmd.z); // 本句的实例 z（仅影响这一句）
  // NVL 激活时当前句追加进累积缓冲（新引用，观察者可感知；随状态快照走）
  // 重放期不追加——buffer 已由快照恢复，重放只重建当前对话键
  if (ctx.get(SYS.nvlMode) === "active" && !ctx.rollbackActive) {
    // 内部累积读原始态（ctx.get 对派生键给译文，追加译文会造成二次翻译）
    const buffer = ctx.state.get(SYS.nvlBuffer);
    ctx.setSystem(SYS.nvlBuffer, [
      ...(Array.isArray(buffer) ? (buffer as string[]) : []),
      text,
    ]);
  }
  ctx.setSystem(SYS.waiting, "dialog");
  // say 的 voice 参数绑定本句语音进 voice 通道（auto_stop 默认 true → 推进过该句即停）
  if (typeof cmd.voice === "string" && cmd.voice !== "") {
    ctx.setSystem(SYS.audioVoice, {
      kind: "play",
      resource: cmd.voice,
      volume: 1,
      loop: false,
      fadeMs: 0,
      autoStop: true,
    } satisfies AudioChannelState);
  }
  // 重放落点（rollbackActive）即检查点本体：live 视为已入档——back() 才能继续向前回退
  ctx.liveCheckpointed = ctx.rollbackActive;
  // 快照在上屏时刻捕获（= 玩家所见画面，帧栈定位在本等待命令上），等待解除后才提交入档。
  // 重放期同样捕获：同坐标提交由 commitCheckpoint 原位替换（幂等），历史在回溯/读档路径上自愈完整
  ctx.pendingSay = ctx.takeSnapshot(ctx.checkpointCoord(frame));
  ctx.autoSaveAtCheckpoint(); // say 等待画面建立 = 玩家所见稳定点，auto_save 开关消费
  // 坐标推进：say 进入等待即前移，坐标恒指「下一待执行命令」——检查点在玩家所见之后
  frame.index += 1;
}

/** menu：写菜单系统键 → 进入 menu 等待（清对话残留） */
export function execMenu(
  ctx: OpContext,
  frame: Frame,
  cmd: StoryCommand,
): void {
  if (ctx.rejectBadInstanceZ(cmd)) return; // 先拒非法 z（不动状态）
  const options = cmd.options as Array<{ text: string; target: string }>; // 解析器已验证结构
  // 状态存原文 + 源（目标列名不翻译——menuTargets 原样）；源先于表面键写入/清除
  const prompt = typeof cmd.prompt === "string" ? cmd.prompt : "";
  updateSources(ctx, {
    dialog: undefined,
    speaker: undefined,
    menu: {
      prompt: prompt === "" ? undefined : captureSource(prompt),
      options: options.map((o) => captureSource(o.text)),
    },
  });
  ctx.setSystem(SYS.currentDialogText, "");
  ctx.setSystem(SYS.currentDialogSpeaker, "");
  ctx.setSystem(SYS.currentDialogColor, ""); // 同清：避免上一句的颜色覆盖残留
  ctx.setSystem(SYS.dialogFont, ""); // 字体同清：换列/菜单后上一句字体不残留
  ctx.setSystem(SYS.menuPrompt, prompt);
  ctx.setSystem(
    SYS.menuOptions,
    options.map((o) => o.text),
  );
  ctx.setSystem(
    SYS.menuTargets,
    options.map((o) => o.target),
  );
  ctx.setSystem(SYS.menuSelected, -1);
  ctx.setInstanceZ(SYS.choicesZ, cmd.z); // 本次菜单的实例 z（choices 层）
  ctx.setSystem(SYS.waiting, "menu");
  // 菜单展示时建检查点（展示中 live == 检查点，回退落回菜单重选）；重放期同坐标原位替换
  ctx.commitCheckpoint(ctx.takeSnapshot(ctx.checkpointCoord(frame)));
  ctx.liveCheckpointed = true;
  ctx.autoSaveAtCheckpoint(); // 菜单等待画面建立 = auto_save 消费点
  frame.index += 1;
}

/** wait/pause（wait 可 skipable、pause=hard；seconds 必填） */
export function execWait(
  ctx: OpContext,
  frame: Frame,
  cmd: StoryCommand,
  hard = false,
): void {
  const fields = hard ? PAUSE_FIELDS : WAIT_FIELDS;
  const unknownFields = Object.keys(cmd).filter((k) => !fields.has(k));
  if (unknownFields.length > 0) {
    ctx.fail(
      `${cmd.op}-unknown-field`,
      `${cmd.op} 未知负载字段：${unknownFields.join(", ")}`,
    );
    return;
  }
  ctx.waitSkipable = !hard && cmd.skipable === true;
  ctx.setSystem(SYS.waiting, "wait");
  // wait 检查点在等待建立时；重放期同坐标原位替换
  ctx.commitCheckpoint(ctx.takeSnapshot(ctx.checkpointCoord(frame)));
  ctx.liveCheckpointed = true;
  ctx.autoSaveAtCheckpoint(); // wait 等待画面建立 = auto_save 消费点
  frame.index += 1;
  armWaitTimer(ctx, Math.max(0, (cmd.seconds as number) * 1000));
}

/** nvl 已知负载字段（未知字段 fail-closed） */
const NVL_FIELDS = new Set(["op", "mode"]);
/** nvl mode 合法值：未知值拒绝，不静默当 enter（作者写错不该被吞掉） */
const NVL_MODES = new Set(["enter", "auto", "clear", "exit"]);

/** NVL：进入/清屏/退出累积层；累积文本进核心状态（回溯/存档自动一致） */
export function execNvl(ctx: OpContext, cmd: StoryCommand): boolean {
  const unknown = Object.keys(cmd).filter((k) => !NVL_FIELDS.has(k));
  if (unknown.length > 0) {
    ctx.fail("nvl-unknown-field", `nvl 未知负载字段：${unknown.join(", ")}`);
    return false;
  }
  const mode = cmd.mode === undefined ? "enter" : cmd.mode;
  if (typeof mode !== "string" || !NVL_MODES.has(mode)) {
    ctx.fail(
      "nvl-invalid-mode",
      `nvl 的 mode 不合法：${JSON.stringify(cmd.mode)}（须为 enter / auto / clear / exit 之一）`,
    );
    return false;
  }
  switch (mode) {
    case "clear":
      // 清屏保留窗口：累积清空，NVL 仍激活
      ctx.setSystem(SYS.nvlBuffer, []);
      ctx.setSystem(SYS.nvlMode, "active");
      break;
    case "exit":
      ctx.setSystem(SYS.nvlBuffer, []);
      ctx.setSystem(SYS.nvlMode, "none");
      break;
    default:
      // enter / auto：进入累积层
      ctx.setSystem(SYS.nvlMode, "active");
  }
  return true;
}

/** character 已知负载字段（未知字段 fail-closed） */
const CHARACTER_FIELDS = new Set([
  "op",
  "key",
  "name",
  "color",
  "size",
  "font",
  "textColor",
  "screen",
]);
/** character 可选字符串字段：给了就必须是字符串（静默忽略会丢作者意图） */
const CHARACTER_STRING_FIELDS = [
  "name",
  "color",
  "size",
  "font",
  "textColor",
  "screen",
] as const;

/** character：注册/更新角色定义（可覆盖更新） */
export function execCharacter(ctx: OpContext, cmd: StoryCommand): boolean {
  const unknown = Object.keys(cmd).filter((k) => !CHARACTER_FIELDS.has(k));
  if (unknown.length > 0) {
    ctx.fail(
      "character-unknown-field",
      `character 未知负载字段：${unknown.join(", ")}`,
    );
    return false;
  }
  const key = cmd.key;
  if (typeof key !== "string" || key === "") {
    ctx.fail("character-invalid-key", "character 需要非空 key 字符串");
    return false;
  }
  const def: CharacterDef = { key };
  for (const field of CHARACTER_STRING_FIELDS) {
    const value = cmd[field];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      ctx.fail("character-invalid-field", `character 的 ${field} 必须是字符串`);
      return false;
    }
    def[field] = value;
  }
  ctx.characters.set(key, def);
  return true;
}

/**
 * uncharacter：注销角色（注册表 delete；随快照/回溯自然回滚）。
 * 键不存在不构成故障：发 character.missing 知情事件后继续推进，
 * 停机与否由创作者在事件侧自行决定（引擎不越权替其裁决）。
 */
export function execUncharacter(ctx: OpContext, cmd: StoryCommand): void {
  const key = cmd.key as string;
  if (!ctx.characters.delete(key)) {
    ctx.emitEvent({ kind: "character.missing", key });
  }
}
