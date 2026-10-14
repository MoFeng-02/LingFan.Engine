/**
 * 存档的玩法系统依赖标记：校验与状态迁移（与 extensions 同构的声明制通道）。
 */
import { gameScopedKey, type SaveDataV1 } from "../../contracts/index.ts";
import type { OpContext } from "../internal/index.ts";

/**
 * 读档玩法系统依赖校验 + 状态迁移（fail-closed 整档预校验——任何不符在进入恢复流程前拒绝）。
 * `entries` = 扩展校验后的状态条目（玩法系统命名空间在此之上迁移）；
 * 返回迁移后的条目（无标记 = 原引用原样返回）；null = 已发 engine.error（整档拒绝，状态原样）。
 */
export function resolveSaveMinigames(
  ctx: OpContext,
  entries: [string, unknown][],
  marks: SaveDataV1["minigames"],
): [string, unknown][] | null {
  if (marks === undefined) return entries; // 未用到玩法系统的存档不带标记（防假阳性）
  if (!Array.isArray(marks)) {
    ctx.fail("save-format", "存档玩法系统依赖标记不合法（须为数组）");
    return null;
  }
  let staged = entries;
  for (const mark of marks) {
    if (
      mark === null ||
      typeof mark !== "object" ||
      typeof mark.id !== "string" ||
      !Number.isInteger(mark.stateVersion) ||
      mark.stateVersion < 1
    ) {
      ctx.fail(
        "save-format",
        "存档玩法系统依赖标记不合法（条目须为 { id, stateVersion }）",
      );
      return null;
    }
    const meta = ctx.minigameById.get(mark.id);
    if (meta === undefined) {
      ctx.fail("minigame-missing", ctx.texts.minigameMissing(mark.id));
      return null;
    }
    if (meta.stateVersion === mark.stateVersion) continue;
    // 版本不一致：仅支持「档旧 → 注册新」迁移；档新于注册（宿主过旧）或无 migrate → 拒绝
    if (mark.stateVersion < meta.stateVersion && meta.migrate) {
      const prefix = gameScopedKey(mark.id, "");
      const subset: Record<string, unknown> = {};
      for (const [key, value] of staged) {
        if (key.startsWith(prefix)) subset[key.slice(prefix.length)] = value;
      }
      let migrated: Record<string, unknown> | null;
      try {
        migrated = meta.migrate(mark.stateVersion, subset);
      } catch {
        migrated = null; // 注册违约（不抛约束）→ 视同无法迁移
      }
      if (migrated === null) {
        ctx.fail(
          "minigame-version",
          ctx.texts.minigameMigrateFailed(mark.id, mark.stateVersion, meta.stateVersion),
        );
        return null;
      }
      staged = [
        ...staged.filter(([key]) => !key.startsWith(prefix)),
        ...Object.entries(migrated).map(
          ([key, value]) => [gameScopedKey(mark.id, key), value] as [string, unknown],
        ),
      ];
      ctx.emitEvent({
        kind: "load.notice",
        text: ctx.texts.minigameMigrated(mark.id, mark.stateVersion, meta.stateVersion),
      });
      continue;
    }
    ctx.fail(
      "minigame-version",
      ctx.texts.minigameVersionDependency(mark.id, mark.stateVersion, meta.stateVersion),
    );
    return null;
  }
  return staged;
}
