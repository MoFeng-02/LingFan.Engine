/**
 * 挂载差量：两次 `SYS.mounts` 之间该做哪几件事。
 *
 * 声明式宿主（Vue / React）靠 `v-for` 加 key 自己就能算出增删，命令式宿主（原生 DOM）
 * 不能——它必须明确知道「谁要挂、谁要卸、谁只是换了入参」。差量策略放在这里而不是
 * 渲染器里，是为了让它**可测**：三形态行为一致的判据，最终落成「同一对输入必得同一份差量」。
 *
 * 只比可见性，不猜组件内部：`props` 变了就整份重渲染，不做浅合并、不做逐字段下发。
 * 组件拿到的永远是完整入参——否则「字段被删了」和「字段没传」在组件里无法区分。
 */
import { isMountTable, type MountTable } from "@lingfan-engine/core";
import { visibleMounts } from "./projection.ts";

/** 一份差量：卸载、挂载、换入参三组名字（各自码点序） */
export interface MountPlan {
  /** 上一帧可见、这一帧不可见或已消失：从渲染树移除 */
  readonly unmount: readonly string[];
  /** 这一帧新出现的可见 UI：新建并挂上 */
  readonly mount: readonly string[];
  /** 两帧都可见但入参变了：卸掉旧的、挂上新的（不是改属性） */
  readonly update: readonly string[];
}

/** 空差量（首帧之前、或两帧相同） */
const EMPTY_PLAN: MountPlan = { unmount: [], mount: [], update: [] };

/**
 * 算两份挂载表之间的差量。
 *
 * @param previous 上一帧的 `SYS.mounts` 原始值（首帧传 `undefined`）
 * @param next 这一帧的原始值
 */
export function planMounts(previous: unknown, next: unknown): MountPlan {
  const before = visibleMounts(previous);
  const after = visibleMounts(next);
  if (before.length === 0 && after.length === 0) return EMPTY_PLAN;
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const unmount: string[] = [];
  const update: string[] = [];
  for (const name of before) {
    if (!afterSet.has(name)) {
      unmount.push(name);
      continue;
    }
    if (!sameProps(previous, next, name)) update.push(name);
  }
  const mount = after.filter((name) => !beforeSet.has(name));
  return { unmount, mount, update };
}

/** 某个名字在两帧里的入参是否等价（名字必须两帧都可见，调用方已判） */
function sameProps(previous: unknown, next: unknown, name: string): boolean {
  if (!isMountTable(previous) || !isMountTable(next)) return false;
  return propsKey(previous, name) === propsKey(next, name);
}

/**
 * 入参的稳定序列化：键排序后拼接，用于「换没换」的判定。
 *
 * 引擎写入侧已保证 props 是 JSON 安全值，所以这里不会遇到函数、循环引用或 `Map`；
 * 真遇到（存档被改坏）也只退化成「判定为不同」，重渲染一次而已，不影响正确性。
 */
function propsKey(table: MountTable, name: string): string {
  const props = table[name]?.props;
  if (props === undefined) return "";
  try {
    return stableStringify(props);
  } catch {
    return "\u0000";
  }
}

/** 键排序的 JSON 序列化（`JSON.stringify` 的键序随插入序变，不能直接比） */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts = keys.map(
    (key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`,
  );
  return `{${parts.join(",")}}`;
}
