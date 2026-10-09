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
} from "../../contracts";
import { interpolateText } from "../expr";
import type { Frame, OpContext } from "../internal";

/** say 的已知负载字段；未知字段 fail-closed */
const SAY_KNOWN_FIELDS = new Set([
  "op",
  "text",
  "speaker",
  // 说话人颜色覆盖（覆盖整句/说话人；与行内标记 `{color=…}` 是两件事）
  "color",
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
export function execSay(
  ctx: OpContext,
  frame: Frame,
  cmd: StoryCommand,
): void {
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
  // 先 Translate 后插值（overlay 键可含 {var} 占位符）+ {var:00} 格式化（仅文本命令）；
  // 行内标记 {b}{p} 原样透传；失败保留原文 + error
  // speaker 与 text 同语义插值——动态说话人（如 func 实参）经此获得真实名字；
  // 说话人显示名同样走 Translate（翻译面覆盖所有展示文字）；
  // 角色模板查表仍用插值后的原值。
  const { text, errors } = interpolateText(
    ctx.translate(cmd.text),
    ctx.resolveName,
    ctx.draw,
  );
  const speakerSrc = typeof cmd.speaker === "string" ? cmd.speaker : "";
  const { text: speakerText, errors: speakerErrors } = interpolateText(
    speakerSrc,
    ctx.resolveName,
    ctx.draw,
  );
  for (const e of [...errors, ...speakerErrors])
    ctx.fail(e.code, `插值失败（保留原文）：${e.message}`);

  // 竞态防护：进入等待前清上一句残留的完成标记（防双击/快速点击跳句）
  ctx.setSystem(SYS.dialogComplete, false);
  ctx.setSystem(SYS.currentDialogSpeaker, ctx.translate(speakerText));
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
  ctx.setSystem(SYS.currentDialogText, text);
  ctx.setSystem(SYS.dialogClickable, cmd.clickable === true);
  ctx.setSystem(SYS.dialogNoskip, cmd.noskip === true);
  ctx.setInstanceZ(SYS.dialogueZ, cmd.z); // 本句的实例 z（仅影响这一句）
  // NVL 激活时当前句追加进累积缓冲（新引用，观察者可感知；随状态快照走）
  // 重放期不追加——buffer 已由快照恢复，重放只重建当前对话键
  if (ctx.get(SYS.nvlMode) === "active" && !ctx.rollbackActive) {
    const buffer = ctx.get(SYS.nvlBuffer);
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
  ctx.setSystem(SYS.currentDialogText, "");
  ctx.setSystem(SYS.currentDialogSpeaker, "");
  ctx.setSystem(SYS.currentDialogColor, ""); // 同清：避免上一句的颜色覆盖残留
  // prompt/选项文案先 Translate（目标列名不翻译——menuTargets 原样）
  ctx.setSystem(
    SYS.menuPrompt,
    typeof cmd.prompt === "string" ? ctx.translate(cmd.prompt) : "",
  );
  ctx.setSystem(
    SYS.menuOptions,
    options.map((o) => ctx.translate(o.text)),
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
  ctx.pendingTimer = setTimeout(
    () => {
      ctx.pendingTimer = null;
      ctx.waitSkipable = false;
      if (ctx.get(SYS.waiting) !== "wait") return; // dispose 等场景防御
      ctx.setSystem(SYS.waiting, "none");
      ctx.liveCheckpointed = false; // live 已越过该检查点
      ctx.run();
    },
    Math.max(0, (cmd.seconds as number) * 1000),
  );
}

/** NVL：进入/清屏/退出累积层；累积文本进核心状态（回溯/存档自动一致） */
export function execNvl(ctx: OpContext, cmd: StoryCommand): void {
  const mode = typeof cmd.mode === "string" ? cmd.mode : "enter";
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
}

/** character：注册/更新角色定义（可覆盖更新） */
export function execCharacter(ctx: OpContext, cmd: StoryCommand): void {
  const key = cmd.key as string;
  const def: CharacterDef = { key };
  if (typeof cmd.name === "string") def.name = cmd.name;
  if (typeof cmd.color === "string") def.color = cmd.color;
  if (typeof cmd.size === "string") def.size = cmd.size;
  if (typeof cmd.font === "string") def.font = cmd.font;
  if (typeof cmd.textColor === "string") def.textColor = cmd.textColor;
  if (typeof cmd.screen === "string") def.screen = cmd.screen;
  ctx.characters.set(key, def);
}
