/**
 * 存档的扩展依赖标记：迁移、校验与恢复。
 */
import { EXT_KEY_PREFIX, type SaveDataV1 } from "../../contracts";
import type { OpContext } from "../internal";
import { buildExtensionContext } from "../opRegistry";

/**
 * `formatVersion` 非 1 的档——优先经宿主 migrateSave 钩子迁移（成功发 `load.notice`）；
 * 不可迁移才拒绝，且文案必须可操作（说明档/引擎版本与可选路径，不得只说「不支持」）。
 */
export function tryMigrateSave(ctx: OpContext, data: SaveDataV1): SaveDataV1 | null {
  const fromVersion = (
    data as { formatVersion?: unknown } | null | undefined
  )?.formatVersion;
  const hook = ctx.migrateSaveHook;
  if (hook) {
    try {
      const migrated = hook(data);
      if (migrated?.formatVersion === 1) {
        ctx.emitEvent({
          kind: "load.notice",
          text: `存档已从 v${String(fromVersion)} 迁移到 v1（migrateSave）`,
        });
        return migrated;
      }
    } catch {
      // 宿主钩子违约（抛出）= 视同无法迁移，走可操作拒绝（读档链不中断）
    }
  }
  ctx.fail(
    "save-format",
    `存档格式版本不支持：档为 v${String(fromVersion)}，引擎为 v1。请用创建该存档的引擎版本打开，或在构造引擎时提供 migrateSave 钩子完成版本迁移`,
  );
  return null;
}

/**
 * 读档扩展依赖校验 + 状态迁移（fail-closed 整档预校验——任何不符在进入恢复流程前拒绝）。
 * 返回迁移后的状态条目（无迁移 = 原引用原样返回）；null = 已发 engine.error（整档拒绝，状态原样）。
 */
export function resolveSaveExtensions(ctx: OpContext, data: SaveDataV1): [string, unknown][] | null {
  const marks = data.extensions;
  if (marks === undefined) return data.state; // 未用到扩展的存档不带标记（防假阳性：缺扩展也能读）
  if (!Array.isArray(marks)) {
    ctx.fail("save-format", "存档扩展依赖标记不合法（须为数组）");
    return null;
  }
  let entries = data.state;
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
        "存档扩展依赖标记不合法（条目须为 { id, stateVersion }）",
      );
      return null;
    }
    const ext = ctx.extensionById.get(mark.id);
    if (ext === undefined) {
      ctx.fail(
        "extension-missing",
        `存档依赖的扩展未注册：「${mark.id}」。请安装并启用该扩展后再读档`,
      );
      return null;
    }
    if (ext.stateVersion === mark.stateVersion) continue;
    // 版本不一致：仅支持「档旧 → 扩展新」迁移；档新于扩展（引擎过旧）或无 migrate → 拒绝
    if (mark.stateVersion < ext.stateVersion && ext.migrate) {
      const prefix = `${EXT_KEY_PREFIX}${mark.id}.`;
      const subset: Record<string, unknown> = {};
      for (const [key, value] of entries) {
        if (key.startsWith(prefix)) subset[key.slice(prefix.length)] = value;
      }
      let migrated: Record<string, unknown> | null;
      try {
        migrated = ext.migrate(mark.stateVersion, subset);
      } catch {
        migrated = null; // 扩展违约（不抛约束）→ 视同无法迁移
      }
      if (migrated === null) {
        ctx.fail(
          "extension-version",
          `扩展「${mark.id}」无法从状态版本 v${mark.stateVersion} 迁移到 v${ext.stateVersion}，存档被拒绝`,
        );
        return null;
      }
      entries = [
        ...entries.filter(([key]) => !key.startsWith(prefix)),
        ...Object.entries(migrated).map(
          ([key, value]) => [`${prefix}${key}`, value] as [string, unknown],
        ),
      ];
      ctx.emitEvent({
        kind: "load.notice",
        text: `扩展「${mark.id}」状态已从 v${mark.stateVersion} 迁移到 v${ext.stateVersion}`,
      });
      continue;
    }
    ctx.fail(
      "extension-version",
      `存档依赖扩展「${mark.id}」的状态版本 v${mark.stateVersion}，当前注册版本为 v${ext.stateVersion}（存档过新或缺少迁移路径），存档被拒绝`,
    );
    return null;
  }
  return entries;
}

/**
 * 读档恢复钩子——对档内标记的扩展逐个调 restore（重建运行期句柄，等价小游戏重新挂载）。
 * 返回 false（或抛出）= 不可恢复 → 调用方整档拒绝（此时仅字段引用交换、零事件出站，
 * 引擎状态即原样）；engine.error 由本方法发出。
 */
export function restoreSaveExtensions(ctx: OpContext, marks: SaveDataV1["extensions"]): boolean {
  for (const mark of marks ?? []) {
    const ext = ctx.extensionById.get(mark.id);
    if (ext?.restore === undefined) continue;
    let ok: boolean;
    try {
      ok = ext.restore(
        buildExtensionContext(mark.id, {
          get: (key) => ctx.get(key),
          setGlobal: (key, value) => ctx.setGlobal(key, value),
          story: ctx.story,
        }),
      );
    } catch {
      ok = false; // 扩展违约（不抛约束）→ 不可恢复
    }
    if (!ok) {
      ctx.fail(
        "extension-restore",
        `扩展「${mark.id}」读档恢复失败（restore 返回 false），存档被拒绝`,
      );
      return false;
    }
  }
  return true;
}
