/**
 * 元素值回写的落点路由：元素层只上报「哪个元素变成了什么值」，落到哪里由本模块决定。
 *
 * 元素渲染器不认识引擎，也不知道「音量」和「分数」有什么区别——它只把
 * `(element, value)` 交出来。本模块是**全仓唯一的落点判定点**（模板骨架与
 * playground 都调它，两处不各判一套，否则作者的同一个 `cmd="volume:bgm"`
 * 在两个宿主里会得到不同结果）：
 *
 * - `cmd="volume:bgm"` / `volume:se` / `volume:ambient` / `volume:voice` → 玩家偏好通道音量；
 * - `cmd="game.<系统>.<键>"` → 外部玩法系统命名空间（经 `GameStateWriter.setScoped`）；
 * - 其余（含无 `cmd`）→ 不落，返回 false 由调用方上报。
 *
 * **三条硬约束**：
 * 1. 本模块**不直写 SSOT**——`__` 保留键由 `GameStateWriter` 的保留键门卫物理挡住，
 *    这里连碰都碰不到（`setVolume` 走偏好、`setScoped` 走 `game.` 前缀）。
 * 2. 形态判定与落点判定分开：`parseWritebackTarget` 是纯解析（可单测），
 *    `routeElementValueChange` 只做分发，不重复解析。
 * 3. 本模块**只做判定与分发**，端口由宿主注入（`ElementWritebackPorts`）——
 *    UI 层因此仍然不持有引擎引用，`ElementInstance` 之外不 import 任何运行时物。
 *
 * 为什么用 `cmd` 当落点而不是新增元素属性：`cmd` 已经是「宿主命名命令」的既有载体
 * （`packages/core/src/contracts/element.ts` 通用属性表），滑块与按钮共用一套寻址，
 * 不为回写另开一个属性名——那会让作者要记两套。
 */
import type { AudioChannel, ElementInstance } from "@lingfan-engine/core";
import { GAME_SYSTEM_ID_PATTERN } from "@lingfan-engine/core";

/** 音量落点前缀（`volume:bgm` 形态） */
const VOLUME_PREFIX = "volume:";

/** 玩法系统落点前缀（`game.<系统>.<键>` 形态，与 `setScoped` 的命名空间同源） */
const GAME_PREFIX = "game.";

/** 四通道白名单：与 `AudioChannel` 同源，写死在这里是为了运行期可判定 */
const AUDIO_CHANNELS: ReadonlySet<string> = new Set([
  "bgm",
  "se",
  "ambient",
  "voice",
]);

/** 回写落点：解析结果是一个判别联合，不认识的一律 `null` */
export type WritebackTarget =
  | { kind: "volume"; channel: AudioChannel }
  | { kind: "game"; systemId: string; key: string };

/**
 * 解析元素的回写落点。`cmd` 为空 / 不认识的形态 ⇒ `null`（调用方按「未声明落点」处理）。
 *
 * `game.` 形态要求**恰好三段**（`game.<系统>.<键>`）：多段会把点号当分隔符吞进键名，
 * 少段则系统 id 缺失——两种都是作者的笔误，宁可解析失败上报，也不要猜。
 */
export function parseWritebackTarget(
  props: Readonly<Record<string, unknown>>,
): WritebackTarget | null {
  const cmd = props.cmd;
  if (typeof cmd !== "string" || cmd === "") return null;

  if (cmd.startsWith(VOLUME_PREFIX)) {
    const channel = cmd.slice(VOLUME_PREFIX.length);
    if (!AUDIO_CHANNELS.has(channel)) return null;
    return { kind: "volume", channel: channel as AudioChannel };
  }

  if (cmd.startsWith(GAME_PREFIX)) {
    const parts = cmd.split(".");
    if (parts.length !== 3) return null;
    const [, systemId, key] = parts;
    if (systemId === undefined || key === undefined) return null;
    if (systemId === "" || key === "") return null;
    // 系统 id 形态与 minigame / interaction 的 `game` 同域（单一形态来源）
    if (!GAME_SYSTEM_ID_PATTERN.test(systemId)) return null;
    return { kind: "game", systemId, key };
  }

  return null;
}

/** 回写落点需要的能力（宿主组合根注入；两件都是既有闸门，不新开写入面） */
export interface ElementWritebackPorts {
  /** 玩家偏好通道音量（内部 clamp01，且触发渲染层重规划） */
  setVolume(channel: AudioChannel, value: number): void;
  /** 外部玩法系统命名空间写入（保留键与 JSON 安全由引擎门卫把关） */
  setScoped(systemId: string, key: string, value: unknown): boolean;
  /** 落点解析失败或写入被拒时的诊断出口 */
  reportError(message: string): void;
}

/**
 * 把一次元素值回写落到宿主既有闸门上。
 *
 * @returns 是否落成功（`false` = 已上报诊断，状态原样）
 */
export function routeElementValueChange(
  element: ElementInstance,
  value: number | string | boolean,
  ports: ElementWritebackPorts,
): boolean {
  const target = parseWritebackTarget(element.props);
  if (target === null) {
    ports.reportError(
      `元素 ${String(element.id)} 的值回写没有落点：cmd 需为 volume:<通道> 或 game.<系统>.<键>`,
    );
    return false;
  }

  if (target.kind === "volume") {
    // 音量是 0..1 的实数：控件给的是 min..max 的刻度值，由元素自身的
    // `min`/`max` 决定量纲，这里不做换算（作者把 min/max 设成 0..1 即是音量）
    if (typeof value !== "number" || !Number.isFinite(value)) {
      ports.reportError(`元素 ${String(element.id)} 的音量回写值不是有限数字`);
      return false;
    }
    ports.setVolume(target.channel, value);
    return true;
  }

  if (!ports.setScoped(target.systemId, target.key, value)) {
    ports.reportError(
      `元素 ${String(element.id)} 的状态回写被拒：${target.systemId}.${target.key}（详见引擎诊断）`,
    );
    return false;
  }
  return true;
}
