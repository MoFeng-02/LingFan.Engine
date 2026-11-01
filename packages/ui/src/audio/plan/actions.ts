/**
 * 差量规划：视图快照前后的差异 → 端口动作序列（纯函数，可单测）。
 *
 * 规划器不知道端口长什么样，也不发起播放；它只回答「为了从 prev 变成 next 要下发哪些动作」。
 */
import type { AudioAction, AudioView } from "../view/index.ts";

/** 常驻通道（se 为一次性触发，单独按 seq 判定） */
const CHANNELS = ["bgm", "ambient", "voice"] as const;

/** 位置差异阈值（秒）：小于此视为播放器噪声，不打断播放（seek 抖动防护） */
const SEEK_THRESHOLD = 0.5;

/**
 * 状态差量 → 端口动作：
 * - 通道由 play 变 stop/null → stop（带淡出参数）
 * - 换资源 → play（bgm 从目标位置起播）
 * - 同资源 + 显式 restart（seq 变化）→ play 回到起点重播
 * - 同资源仅音量/循环变化 → play 更新（适配器不重头播）；bgm 位置差超阈值 → 定位
 * - play 变 pause → pause（保留实例与位置）；pause 变 play → resume（不重播、不从头）
 * - pause 变 stop/null → stop（暂停中的通道也要先停掉，否则实例一直占着）
 * - se 按单调 seq 判定：每次执行都触发一次（同一资源连续触发亦然）；`stop` 形态同样按 seq 判定
 */
export function planAudioActions(
  prev: AudioView,
  next: AudioView,
): AudioAction[] {
  const actions: AudioAction[] = [];
  for (const channel of CHANNELS) {
    const before = prev[channel];
    const after = next[channel];
    if (after !== null && after.kind === "pause") {
      // 暂停：只有「正在出声」才需要收声；本来就是暂停/停止的通道无动作
      if (before !== null && before.kind === "play") {
        actions.push({ type: "pause", channel });
      }
      continue;
    }
    if (after === null || after.kind !== "play") {
      if (
        before !== null &&
        (before.kind === "play" || before.kind === "pause")
      ) {
        actions.push({
          type: "stop",
          channel,
          fadeMs: after !== null && after.kind === "stop" ? after.fadeMs : 0,
        });
      }
      continue;
    }
    if (before !== null && before.kind === "pause") {
      // 从暂停回到播放：走 resume 而不是 play——play 会从起点重播，
      // 暂停的意义恰恰是保住位置（资源与位置都在端口的播放器实例里）
      actions.push({ type: "resume", channel });
      continue;
    }
    const position = channel === "bgm" ? next.bgmPosition : 0;
    const sameResource =
      before !== null &&
      before.kind === "play" &&
      before.resource === after.resource;
    if (!sameResource) {
      actions.push({
        type: "play",
        channel,
        resource: after.resource,
        volume: after.volume,
        loop: after.loop,
        position,
        fadeMs: after.fadeMs,
        restart: true,
      });
      continue;
    }
    // 同资源：显式重播优先于增量更新（seq 变化 = 这是一次新的重播请求）
    if (after.restart === true && after.seq !== before.seq) {
      actions.push({
        type: "play",
        channel,
        resource: after.resource,
        volume: after.volume,
        loop: after.loop,
        position: 0,
        fadeMs: after.fadeMs,
        restart: true,
      });
      continue;
    }
    if (before.volume !== after.volume || before.loop !== after.loop) {
      actions.push({
        type: "play",
        channel,
        resource: after.resource,
        volume: after.volume,
        loop: after.loop,
        position,
        fadeMs: after.fadeMs,
        restart: false,
      });
      continue;
    }
    if (
      channel === "bgm" &&
      Math.abs(next.bgmPosition - prev.bgmPosition) > SEEK_THRESHOLD
    ) {
      actions.push({
        type: "play",
        channel,
        resource: after.resource,
        volume: after.volume,
        loop: after.loop,
        position,
        fadeMs: 0,
        restart: false,
      });
    }
  }
  actions.push(...planInstanceActions(prev, next));
  const beforeSe = prev.se;
  const afterSe = next.se;
  if (
    afterSe !== null &&
    afterSe.kind === "play" &&
    (beforeSe === null ||
      beforeSe.kind !== "play" ||
      beforeSe.seq !== afterSe.seq)
  ) {
    actions.push({
      type: "play",
      channel: "se",
      resource: afterSe.resource,
      volume: afterSe.volume,
      loop: false,
      position: 0,
      fadeMs: 0,
      restart: true,
    });
  }
  // 音效停止：与触发同样按单调 seq 判定（连续两次停止也是两次独立事件，
  // 否则第二次停不掉第一次停止之后新触发的音效）
  if (
    afterSe !== null &&
    afterSe.kind === "stop" &&
    (beforeSe === null || beforeSe.seq !== afterSe.seq)
  ) {
    actions.push({ type: "stop", channel: "se", fadeMs: afterSe.fadeMs });
  }
  return actions;
}

/**
 * 实例差量：只翻 play ↔ pause 这一对。
 *
 * 引擎暂停会把在播实例写成 `pause` 态（暂停前的 play 态记在 `SYS.audioPaused`），
 * 恢复时再写回 play 态——两次都是整表替换，渲染层看到的就是这一对变迁。
 * 实例的起播与收声不在这里：那是实例命令面（`audio_play` / `audio_stop`）的职责，
 * 两边都下发会重复。按 id 排序遍历，保证动作序列确定（与实例表的排序口径一致）。
 */
function planInstanceActions(prev: AudioView, next: AudioView): AudioAction[] {
  const actions: AudioAction[] = [];
  const ids = Object.keys(next.instances);
  for (const id of Object.keys(prev.instances)) {
    if (!(id in next.instances)) ids.push(id);
  }
  ids.sort();
  for (const instanceId of ids) {
    const before = prev.instances[instanceId];
    const after = next.instances[instanceId];
    if (after !== undefined && after.kind === "pause") {
      if (before !== undefined && before.kind === "play") {
        actions.push({ type: "pauseInstance", instanceId });
      }
      continue;
    }
    if (after !== undefined && after.kind === "play") {
      if (before !== undefined && before.kind === "pause") {
        // 与通道同构：resume 而不是 play——play 会从头起播，暂停的意义是保住位置
        actions.push({ type: "resumeInstance", instanceId });
      }
    }
  }
  return actions;
}
