/**
 * 自定义 op 注册表：扩展声明 → 注册期校验 → 运行期查找。
 *
 * 注册期校验（组合根 fail-fast：任一非法 = 构造抛错带定位）：
 * - `extensionId` 形态（`EXTENSION_ID_PATTERN`）
 * - op 名形态（同 pattern）且**不得与内建 op 重名**（`BUILTIN_OP_NAMES`）或跨扩展重复
 * - 查找顺序 = **内建 → 扩展 → `unknown-op` fail-closed**（内建永远赢，扩展永不覆盖内建）
 *
 * 状态命名空间：`ExtensionContext` 物理强制 `ext.<extensionId>.` 前缀（门卫）——
 * 扩展代码写不出前缀外的键；`ext.*` 不命中保留键集合（`RESERVED_STATE_KEYS` = SYS 精确名），
 * 值守卫复用引擎写入契约（`jsonUnsafeReason`/深走查）。
 */

import {
  EXTENSION_ID_PATTERN,
  EXT_KEY_PREFIX,
  type CustomOpProjections,
  type ExecOutcome,
  type ExtensionContext,
  type OpDefinition,
  type OpExtension,
  type OpTextProjection,
  type Story,
} from "../contracts";

/** 单个已注册 op：扩展身份（存档依赖标记用）+ 运行期定义 */
export interface RegisteredOp {
  readonly extensionId: string;
  readonly stateVersion: number;
  readonly definition: OpDefinition;
}

/** 内建 op 名全集（分发 switch 的 case 清单；互锁测试锁定与 engine.ts 分发一致） */
export const BUILTIN_OP_NAMES: ReadonlySet<string> = new Set([
  "say",
  "menu",
  "wait",
  "pause",
  "jump",
  "navigate",
  "save",
  "load",
  "auto_save",
  "save_delete",
  "if",
  "while",
  "for",
  "foreach",
  "switch",
  "break",
  "continue",
  "assert",
  "guard",
  "set",
  "let",
  "local",
  "define",
  "undef",
  "func",
  "call",
  "return",
  "input",
  "array",
  "array_push",
  "array_pop",
  "dict",
  "dict_set",
  "notify",
  "random",
  "nvl",
  "character",
  "bgm",
  "se",
  "ambient",
  "stop_bgm",
  "stop_ambient",
  "voice",
  "stop_voice",
  "video",
  "seek_video",
  "pause_video",
  "resume_video",
  "stop_video",
  "video_skipable",
  "cutscene",
  "minigame",
  "show",
  "hide",
  "background",
  "bg_switch",
  "zindex",
  "style",
  "window",
  "animate",
  "animate_block",
  "transition",
  "shake",
  "text_typewriter",
]);

function validOpName(op: string): boolean {
  return EXTENSION_ID_PATTERN.test(op);
}

/**
 * 构建扩展 op 注册表（引擎构造期调用一次）。
 * 任一声明非法 → 抛错（带扩展 id 与 op 名定位）。
 */
export function buildOpRegistry(
  extensions: readonly OpExtension[],
): Map<string, RegisteredOp> {
  const registry = new Map<string, RegisteredOp>();
  const seenExtensions = new Set<string>();
  for (const extension of extensions) {
    if (
      typeof extension.id !== "string" ||
      !EXTENSION_ID_PATTERN.test(extension.id)
    ) {
      throw new Error(
        `扩展 id 不合法：${String(extension.id)}（须匹配 ${EXTENSION_ID_PATTERN.source}）`,
      );
    }
    if (seenExtensions.has(extension.id)) {
      throw new Error(`扩展 id 重复注册：${extension.id}`);
    }
    seenExtensions.add(extension.id);
    if (
      typeof extension.stateVersion !== "number" ||
      extension.stateVersion < 1
    ) {
      throw new Error(
        `扩展 ${extension.id} 的 stateVersion 不合法：${String(extension.stateVersion)}（须为正整数）`,
      );
    }
    for (const definition of extension.ops ?? []) {
      if (typeof definition.op !== "string" || !validOpName(definition.op)) {
        throw new Error(
          `扩展 ${extension.id} 的 op 名不合法：${String(definition.op)}`,
        );
      }
      if (BUILTIN_OP_NAMES.has(definition.op)) {
        throw new Error(
          `扩展 ${extension.id} 的 op「${definition.op}」与内建 op 冲突（内建不可覆盖）`,
        );
      }
      if (registry.has(definition.op)) {
        throw new Error(
          `扩展 ${extension.id} 的 op「${definition.op}」与其他扩展重复`,
        );
      }
      if (typeof definition.exec !== "function") {
        throw new Error(
          `扩展 ${extension.id} 的 op「${definition.op}」缺少 exec`,
        );
      }
      registry.set(definition.op, {
        extensionId: extension.id,
        stateVersion: extension.stateVersion,
        definition,
      });
    }
  }
  return registry;
}

/** 构造扩展执行上下文（门卫：get/set 物理强制 `ext.<id>.` 前缀；story 只读） */
export function buildExtensionContext(
  extensionId: string,
  engine: {
    get(key: string): unknown;
    setGlobal(key: string, value: unknown): void;
    story: Story;
  },
): ExtensionContext {
  const scoped = (key: string): string =>
    `${EXT_KEY_PREFIX}${extensionId}.${key}`;
  return {
    get: (key) => engine.get(scoped(key)),
    set: (key, value) => engine.setGlobal(scoped(key), value),
    story: engine.story,
  };
}

/**
 * 执行已注册的扩展 op（fail-closed）：exec 抛出 = 扩展违约 → 兜底转
 * `custom-op-threw`（异常收敛为错误码，不中断解释循环）；本函数不改状态（副作用只在 exec 内经 ctx）。
 */
export function runRegisteredOp(
  entry: RegisteredOp,
  cmd: Readonly<Record<string, unknown>>,
  story: Story,
  state: {
    get(key: string): unknown;
    setGlobal(key: string, value: unknown): void;
  },
): ExecOutcome {
  try {
    const ctx = buildExtensionContext(entry.extensionId, {
      get: state.get,
      setGlobal: state.setGlobal,
      story,
    });
    return entry.definition.exec(cmd, ctx);
  } catch (error: unknown) {
    return {
      ok: false,
      code: "custom-op-threw",
      message: `扩展 ${entry.extensionId} 的 op「${entry.definition.op}」抛出异常：${String(
        error instanceof Error ? error.message : error,
      )}`,
    };
  }
}

/** 扩展命名空间状态键前缀判定（存档依赖标记/卸载清理用） */
export function isExtensionStateKey(key: string): boolean {
  return key.startsWith(EXT_KEY_PREFIX);
}

/**
 * 聚合扩展文本投影（组合根用）：只收声明了 `project` 的 op。
 * op 名冲突不可能（注册期 `buildOpRegistry` 查重先抛）；缺省（无扩展/无投影）= 现行为不变。
 */
export function collectTextProjections(
  extensions: readonly OpExtension[],
): CustomOpProjections {
  const map = new Map<string, OpTextProjection>();
  for (const extension of extensions) {
    for (const definition of extension.ops ?? []) {
      if (definition.project !== undefined) {
        map.set(definition.op, definition.project);
      }
    }
  }
  return map;
}
