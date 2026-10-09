/**
 * 存档类命令的执行：save / load / auto_save / save_delete。
 *
 * 这一族只做**声明与校验**：槽位与端口在命令执行期即时判定并 fail-closed，
 * 真正的写盘、读档与删档由存档编排端口接手，命令自身不等画面建立。
 */
import { SYS, type StoryCommand } from "../../contracts";
import { validSlot, type Frame, type OpContext } from "../internal";

/** 存档类 op 已知负载字段（未知字段 fail-closed） */
const SAVE_FIELDS: Record<string, ReadonlySet<string>> = {
  save: new Set(["op", "slot", "title"]),
  load: new Set(["op", "slot"]),
  auto_save: new Set(["op", "enabled"]),
  save_delete: new Set(["op", "slot"]),
};

/**
 * save op：声明存档点——载荷落到**下一玩家所见等待画面**（存档坐标
 * 必须是可重放重建的等待点；「命令位置快照」与此不同构，重放侧效即由此规避）。
 * 槽位/端口校验立即 fail-closed；声明本身非等待命令，故事立即继续。
 */
export function execSaveOp(
  ctx: OpContext,
  frame: Frame,
  cmd: StoryCommand,
): boolean {
  const unknownFields = Object.keys(cmd).filter((k) => !SAVE_FIELDS.save.has(k));
  if (unknownFields.length > 0) {
    ctx.fail(
      "save-unknown-field",
      `save 未知负载字段：${unknownFields.join(", ")}`,
    );
    return false;
  }
  if (typeof cmd.slot !== "string" || !validSlot(cmd.slot)) {
    ctx.fail(
      "save-invalid-slot",
      "save.slot 必填且槽位名合法（字母数字/_/-，1..64）",
    );
    return false;
  }
  if (cmd.title !== undefined && typeof cmd.title !== "string") {
    ctx.fail("save-invalid", "save.title 必须为字符串");
    return false;
  }
  if (ctx.savePort === undefined) {
    ctx.fail(
      "save-unavailable",
      "未装配 SavePort（组合根经 EngineOptions 注入）",
    );
    return false;
  }
  ctx.pendingSave = {
    slot: cmd.slot,
    title: typeof cmd.title === "string" ? cmd.title : undefined,
  };
  frame.index += 1; // 非等待命令：推进游标（run 循环 continue 后取下一条）
  return true;
}

/** load op：读档传送（复用会话命令 load；异步 importSave 后即传送） */
export function execLoadOp(
  ctx: OpContext,
  frame: Frame,
  cmd: StoryCommand,
): boolean {
  const unknownFields = Object.keys(cmd).filter((k) => !SAVE_FIELDS.load.has(k));
  if (unknownFields.length > 0) {
    ctx.fail(
      "load-unknown-field",
      `load 未知负载字段：${unknownFields.join(", ")}`,
    );
    return false;
  }
  if (typeof cmd.slot !== "string" || cmd.slot === "") {
    ctx.fail("load-invalid", "load.slot 必填（槽位名）");
    return false;
  }
  const kicked = ctx.load(cmd.slot);
  if (kicked) frame.index += 1; // kick 成功即推进（异步传送由 importSave 接管后续）
  return kicked;
}

/**
 * auto_save op：开关系统键 `__auto_save`（编译期与 set 同语义）。
 * 消费点 = 等待画面建立时（autoSaveAtCheckpoint）；开关是系统键 → 不进用户存档、读档后复位。
 */
export function execAutoSaveOp(
  ctx: OpContext,
  frame: Frame,
  cmd: StoryCommand,
): boolean {
  const unknownFields = Object.keys(cmd).filter(
    (k) => !SAVE_FIELDS.auto_save.has(k),
  );
  if (unknownFields.length > 0) {
    ctx.fail(
      "auto_save-unknown-field",
      `auto_save 未知负载字段：${unknownFields.join(", ")}`,
    );
    return false;
  }
  if (cmd.enabled !== true && cmd.enabled !== false) {
    ctx.fail(
      "auto_save-invalid",
      "auto_save.enabled 必须为布尔（true/false）",
    );
    return false;
  }
  ctx.setSystem(SYS.autoSave, cmd.enabled);
  frame.index += 1; // 非等待命令：推进游标
  return true;
}

/** save_delete op：删除槽位（异步 kick；删档不动高水位——防回档基准不随删档回退） */
export function execSaveDeleteOp(
  ctx: OpContext,
  frame: Frame,
  cmd: StoryCommand,
): boolean {
  const unknownFields = Object.keys(cmd).filter(
    (k) => !SAVE_FIELDS.save_delete.has(k),
  );
  if (unknownFields.length > 0) {
    ctx.fail(
      "save_delete-unknown-field",
      `save_delete 未知负载字段：${unknownFields.join(", ")}`,
    );
    return false;
  }
  if (typeof cmd.slot !== "string" || !validSlot(cmd.slot)) {
    ctx.fail("save_delete-invalid", "save_delete.slot 必填且槽位名合法");
    return false;
  }
  const port = ctx.savePort;
  if (port === undefined) {
    ctx.fail(
      "save-unavailable",
      "未装配 SavePort（组合根经 EngineOptions 注入）",
    );
    return false;
  }
  const slot = cmd.slot;
  void port.remove(slot).catch((e: unknown) => {
    ctx.fail("save-delete-failed", `槽位 ${slot} 删除失败：${String(e)}`);
  });
  frame.index += 1; // 非等待命令：推进游标
  return true;
}
