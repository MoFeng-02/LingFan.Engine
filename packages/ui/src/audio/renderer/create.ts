/**
 * 渲染器：订阅音频状态键 → 重算视图 → 规划差量 → 落到端口。
 *
 * 资源解析、代际取消、释放都在这里；它不持有业务状态，唯一的本地态是「上一次的视图」。
 */
import type {
  AudioChannel,
  AudioPort,
  ResourcePort,
  StoryEngine,
} from "@lingfan-engine/core";
import { createStateReader, SYS } from "@lingfan-engine/core";
import { createResourceUrlCache } from "../../resources";
import { planAudioActions } from "../plan/index.ts";
import { EMPTY_AUDIO_VIEW, readAudioView } from "../view/index.ts";
import type { AudioAction, AudioView } from "../view/index.ts";
import type { AudioRenderer, AudioRendererOptions } from "./types.ts";

/**
 * `AudioAction` 中 play 分支的别名（按 `type` 判别后的收窄形态）。
 * 它不是新的动作形状，字段仍以 `AudioAction` 的 play 分支为唯一来源，只是给
 * 「已经排除了 stop」的本地执行边界一个名字：`apply` 处理掉 stop 后把剩下的交给
 * `playAction` 逐条落地播放，参数用它写明「这里拿到的必然是 play」。
 */
type PlayAction = Extract<AudioAction, { type: "play" }>;

/** `AudioAction` 中 playInstance 分支的别名（与 `PlayAction` 同口径，按实例 id 执行） */
type PlayInstanceAction = Extract<AudioAction, { type: "playInstance" }>;

/**
 * 造一个音频渲染器并立即订阅四条通道的音频状态（构造末尾先自同步一次）。
 *
 * 它按通道分代际，迟到的旧解析结果不误播；资源 URL 经共享缓存取，`dispose` 时
 * 逐个 `resources.release` 并退订。位置回写不由本层计时——宿主每帧调 `pollPosition`。
 */
export function createAudioRenderer(
  engine: StoryEngine,
  port: AudioPort,
  resources: ResourcePort,
  options: AudioRendererOptions = {},
): AudioRenderer {
  const audioKeys = new Set<string>([
    SYS.audioBgm,
    SYS.audioSe,
    SYS.audioAmbient,
    SYS.audioVoice,
    SYS.audioInstances,
  ]);
  const reader = createStateReader(engine);
  let view: AudioView = EMPTY_AUDIO_VIEW;
  /**
   * 已解析 URL 缓存（逻辑资源 → URL）：常驻曲目复用解析结果，会话结束统一 release。
   * 不做引用计数/中途回收——VN 的资源集合有界，改用 LRU + refcount 的前提是长会话大量换曲。
   */
  const urls = createResourceUrlCache((resource) =>
    resources.resolve(resource),
  );
  /** 每通道动作代际：异步解析落地时若已被更新动作/停止取代，丢弃该次播放（防错播） */
  const generations = new Map<AudioChannel, number>();
  /**
   * 每实例动作代际：实例各自独立叠放，同一通道可挂多个实例，代际必须按 id 分，
   * 不能借用通道代际（否则停一个实例会作废同通道其它实例的在途解析）。
   */
  const instanceGenerations = new Map<string, number>();

  function invalidate(channel: AudioChannel): void {
    generations.set(channel, (generations.get(channel) ?? 0) + 1);
  }

  function invalidateInstance(instanceId: string): void {
    instanceGenerations.set(
      instanceId,
      (instanceGenerations.get(instanceId) ?? 0) + 1,
    );
  }

  async function resolveUrl(resource: string): Promise<string | null> {
    try {
      return await urls.resolve(resource);
    } catch (e) {
      options.onError?.(`资源解析失败：${resource}（${String(e)}）`);
      return null; // fail-closed：不播放（诊断已上报，不静默）
    }
  }

  async function playAction(action: PlayAction): Promise<void> {
    // se 为一次性触发：每次独立播放，不参与代际取消（允许叠放）
    const guarded = action.channel !== "se";
    if (guarded) invalidate(action.channel);
    const generation = generations.get(action.channel);
    const url = await resolveUrl(action.resource);
    if (url === null) return;
    if (guarded && generations.get(action.channel) !== generation) return;
    port.play(action.channel, url, {
      volume: action.volume,
      loop: action.loop,
      position: action.position,
      fadeMs: action.fadeMs,
      restart: action.restart,
    });
  }

  async function playInstanceAction(action: PlayInstanceAction): Promise<void> {
    // 实例是持久编排单元（不像通道级 se 那样一次性叠放），按 id 代际取消迟到的旧解析
    invalidateInstance(action.instanceId);
    const generation = instanceGenerations.get(action.instanceId);
    const url = await resolveUrl(action.resource);
    if (url === null) return;
    if (instanceGenerations.get(action.instanceId) !== generation) return;
    // 端口未实现实例起播就静默跳过：实例族是可选能力（小程序平台不实现），
    // 缺它退化为「实例不出声」，不能因此整段音频停摆或反复报错
    port.playInstance?.(action.instanceId, url, {
      volume: action.volume,
      loop: action.loop,
      position: action.position,
      fadeMs: action.fadeMs,
      restart: action.restart,
    });
  }

  function apply(actions: AudioAction[]): void {
    for (const action of actions) {
      if (action.type === "stop") {
        invalidate(action.channel); // 停止使在途解析作废
        port.stop(action.channel, action.fadeMs);
        continue;
      }
      if (action.type === "pause") {
        invalidate(action.channel); // 在途解析落地会立刻出声，暂停同样作废
        port.pause(action.channel);
        continue;
      }
      if (action.type === "resume") {
        port.resume(action.channel);
        continue;
      }
      if (action.type === "pauseInstance") {
        // 端口未实现实例暂停就静默跳过：实例族是可选能力，缺它退化为
        // 「实例不随引擎暂停」，不能因此整段音频停摆或反复报错
        invalidateInstance(action.instanceId); // 在途解析落地会立刻出声，暂停同样作废
        port.pauseInstance?.(action.instanceId);
        continue;
      }
      if (action.type === "resumeInstance") {
        port.resumeInstance?.(action.instanceId);
        continue;
      }
      if (action.type === "stopInstance") {
        invalidateInstance(action.instanceId); // 停止使在途解析作废
        port.stopInstance?.(action.instanceId, action.fadeMs);
        continue;
      }
      if (action.type === "playInstance") {
        void playInstanceAction(action);
        continue;
      }
      void playAction(action);
    }
  }

  function sync(): void {
    const next = readAudioView(engine, options.preferences);
    apply(planAudioActions(view, next));
    view = next;
  }

  const offState = engine.onStateChanged((change) => {
    if (audioKeys.has(change.key)) sync();
  });
  // 偏好变化（滑块/静音）→ 合成音量差量 → play 更新动作（同资源不重播）
  const offPrefs = options.preferences?.onChange(() => sync()) ?? null;
  sync();

  return {
    sync,
    pollPosition(): void {
      const bgm = reader.audioChannel("bgm");
      if (bgm === null || bgm.kind !== "play") return;
      const seconds = port.position("bgm");
      if (seconds <= 0) return;
      engine.reportMediaPosition(seconds);
      // 同步视图：避免下一帧把自身回写当成 seek 目标
      view = { ...view, bgmPosition: seconds };
    },
    dispose(): void {
      offState();
      offPrefs?.();
      for (const url of urls.values()) resources.release(url);
      urls.clear();
      generations.clear();
      instanceGenerations.clear();
    },
  };
}
