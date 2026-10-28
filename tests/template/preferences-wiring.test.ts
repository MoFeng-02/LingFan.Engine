/**
 * 模板偏好接线：把「已经存在但没接上」的那条链路锁进模板。
 *
 * 三件事分开验，因为坏掉的方式不同：
 * - **装配层**：`boot.ts` 有没有真的构造偏好、传给两个渲染器、写进宿主句柄、末了收尾。
 *   这一层靠源码互锁——模板是交付物，装配漏一行在用户工程里就是「音量调了没反应」，
 *   而单元测试跑不到 `bootHost`（它要 fetch、localStorage、VideoPort 全套）。
 * - **合成层**：有效音量 = op 音量 × 通道偏好，且**只改音量不重头播**。
 *   这一层跑真 `PlayerPreferences` + 真 `createAudioRenderer` + 契约 Mock 端口。
 * - **降级层**：存储畸形 / 载入抛错都不得挡住启动，按默认值起航。
 *
 * 用 `?raw` 读源码、不碰 fs：`tests/template` 属前端域，禁 Node 导入。
 */
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PLAYER_PREFS,
  PlayerPreferences,
  SYS,
  StoryEngine,
  parseStory,
  type AudioChannel,
  type AudioChannelState,
  type AudioPlayOptions,
  type AudioPort,
  type PlayerPrefsData,
  type PreferencesPort,
  type ResourcePort,
} from "@lingfan-engine/core";
import { createAudioRenderer } from "@lingfan-engine/ui";
import bootSource from "../../template/v1/__PROJECT__/src/host/boot.ts?raw";
import wiringSource from "../../template/v1/__PROJECT__/src/host/engine-wiring.ts?raw";
import handleSource from "../../template/v1/__PROJECT__/src/host/index.ts?raw";

/** 契约可行的内存偏好端口：只实现 load/save，不含任何宿主 API */
function makePort(initial: unknown): PreferencesPort & {
  saved: PlayerPrefsData[];
} {
  const saved: PlayerPrefsData[] = [];
  return {
    saved,
    async load() {
      return initial as PlayerPrefsData | null;
    },
    async save(data) {
      saved.push(data);
    },
  };
}

/** 契约 Mock 的音频端口：记录动作，不做任何解码 */
function makeAudioPort(): { port: AudioPort; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    port: {
      play(channel: AudioChannel, url: string, options: AudioPlayOptions) {
        // restart 决定了适配器要不要回到起点：本组只关心「音量改了但没重播」
        calls.push(
          `${channel}|${url}|${String(options.volume)}|${String(options.restart)}`,
        );
      },
      stop(channel: AudioChannel) {
        calls.push(`${channel}|stop`);
      },
      position() {
        return 0;
      },
      dispose() {
        calls.push("dispose");
      },
    },
  };
}

/** 契约 Mock 的资源端口：逻辑 id 直通为 URL */
function makeResourcePort(): ResourcePort {
  return {
    resolve(id: string) {
      return Promise.resolve(`/${id}`);
    },
    release() {
      /* 纯 Mock：无缓存需要释放 */
    },
  };
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("模板偏好接线 · 装配层（源码互锁）", () => {
  it("boot 构造偏好并 hydrate（失败按默认起航，不炸启动）", () => {
    expect(bootSource).toContain("new PlayerPreferences(");
    expect(bootSource).toContain("await preferences.hydrate()");
    // hydrate 包在装配流程里而不是 try 之后才补：端口实现负责吞掉畸形数据
    expect(bootSource).toContain("createWebStoragePreferencesPort");
  });

  it("偏好传给音频与视频两个渲染器（漏一个 = 那一路的音量调不动）", () => {
    // 按**调用点**（带左括号）定位，不能按裸名字：顶部 import 块里也有这个名字
    const audioAt = bootSource.indexOf("createAudioRenderer(engine");
    const videoAt = bootSource.indexOf("createVideoRenderer(engine");
    expect(audioAt).toBeGreaterThan(-1);
    expect(videoAt).toBeGreaterThan(audioAt);
    // 音频那段到视频调用之间必须出现 preferences（选项对象里）
    expect(bootSource.slice(audioAt, videoAt)).toContain("preferences");
    // 视频那段到 toast 装配之间同理
    const toastAt = bootSource.indexOf("createToast(");
    expect(bootSource.slice(videoAt, toastAt)).toContain("preferences");
  });

  it("宿主句柄带出偏好，且拆除时最后收尾（补发防抖窗内未落盘的末次修改）", () => {
    expect(handleSource).toContain("preferences");
    expect(bootSource).toContain("return { engine, preferences, dispose }");
    // dispose 里 preferences 必须排在 engine.dispose 之后：引擎已停，没人再改它
    const disposeBlock = bootSource.slice(bootSource.indexOf("const dispose"));
    expect(disposeBlock.indexOf("preferences.dispose()")).toBeGreaterThan(
      disposeBlock.indexOf("engine.dispose()"),
    );
  });

  it("元素回写落点接到偏好与 gameState（音量走偏好、玩法走命名空间）", () => {
    expect(wiringSource).toContain("routeElementValueChange");
    expect(wiringSource).toContain("preferences");
    expect(wiringSource).toContain("gameState");
    expect(wiringSource).toContain("onElementValueChange:");
  });

  it("宿主不自己造节点：面板容器由组合根给，给了才装", () => {
    expect(bootSource).toContain("prefsContainer");
    // 宿主内不得出现 document.body.appendChild 这类自造挂载点
    expect(bootSource).not.toContain("document.body.appendChild");
  });
});

describe("模板偏好接线 · 合成层（有效音量 = op × 通道偏好）", () => {
  function makeEngine(): StoryEngine {
    return new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "prefs-wiring",
        columns: [
          {
            id: "start",
            kind: "flow",
            commands: [{ op: "bgm", resource: "Audio/bgm.mp3", volume: 0.5 }],
          },
        ],
      }),
      { rngSeed: 5 },
    );
  }

  it("默认基线 = DEFAULT_PLAYER_PREFS（bgm 0.8 / se 0.6 / ambient 0.8 / voice 1）", async () => {
    const preferences = new PlayerPreferences(makePort(null));
    await preferences.hydrate();
    const snap = preferences.snapshot();
    expect(snap.volumes).toEqual(DEFAULT_PLAYER_PREFS.volumes);
    expect(snap.muted).toBe(false);
    expect(snap.textSpeed).toBe(DEFAULT_PLAYER_PREFS.textSpeed);
  });

  it("setVolume 后实际下发音量 = op 音量 × 通道偏好，且不重头播", async () => {
    const preferences = new PlayerPreferences(makePort({ v: 1 }));
    await preferences.hydrate();
    const engine = makeEngine();
    const { port, calls } = makeAudioPort();
    const renderer = createAudioRenderer(engine, port, makeResourcePort(), {
      preferences,
    });

    engine.start();
    await flush();
    // op 音量 0.5 × 默认 bgm 偏好 0.8 = 0.4
    expect(calls).toEqual(["bgm|/Audio/bgm.mp3|0.4|true"]);

    calls.length = 0;
    preferences.setVolume("bgm", 0.3);
    await flush();
    // 0.5 × 0.3 = 0.15；restart=false ⇒ 适配器只改音量，不回到起点
    expect(calls).toEqual(["bgm|/Audio/bgm.mp3|0.15|false"]);

    renderer.dispose();
  });

  it("静音下发 0 但不停播；取消静音恢复通道音量", async () => {
    const preferences = new PlayerPreferences(makePort({ v: 1 }));
    await preferences.hydrate();
    const engine = makeEngine();
    const { port, calls } = makeAudioPort();
    const renderer = createAudioRenderer(engine, port, makeResourcePort(), {
      preferences,
    });
    engine.start();
    await flush();
    calls.length = 0;

    preferences.setMuted(true);
    await flush();
    expect(calls).toEqual(["bgm|/Audio/bgm.mp3|0|false"]);

    calls.length = 0;
    preferences.setMuted(false);
    await flush();
    expect(calls).toEqual(["bgm|/Audio/bgm.mp3|0.4|false"]);

    renderer.dispose();
  });

  it("偏好变化会触发重规划（订阅没接上时这条必红——正是要修的缺口）", async () => {
    const preferences = new PlayerPreferences(makePort({ v: 1 }));
    await preferences.hydrate();
    const engine = makeEngine();
    const { port, calls } = makeAudioPort();
    const renderer = createAudioRenderer(engine, port, makeResourcePort(), {
      preferences,
    });
    engine.start();
    await flush();
    calls.length = 0;

    // 四通道各调一次：只改偏好的通道出动作，其余通道零动作
    for (const channel of ["bgm", "se", "ambient", "voice"] as const) {
      calls.length = 0;
      preferences.setVolume(channel, 0.5);
      await flush();
      if (channel === "bgm") {
        expect(calls).toEqual(["bgm|/Audio/bgm.mp3|0.25|false"]);
      } else {
        expect(calls).toEqual([]);
      }
    }

    renderer.dispose();
    // 退订后偏好变化不再触达端口
    calls.length = 0;
    preferences.setVolume("bgm", 0.1);
    await flush();
    expect(calls).toEqual([]);
  });
});

describe("模板偏好接线 · 降级层（存坏了也要起航）", () => {
  it("畸形字段逐项降级：非法音量回默认、非法静音回 false、非法字速夹到 1", async () => {
    const broken = {
      v: 1,
      volumes: { bgm: "0.3", se: null, ambient: 9, voice: -4 },
      muted: "yes",
      textSpeed: 0,
    };
    const preferences = new PlayerPreferences(makePort(broken));
    await preferences.hydrate();
    const snap = preferences.snapshot();
    // 非数字 = 该通道回默认；越界数字 = 钳到 0..1
    expect(snap.volumes.bgm).toBe(DEFAULT_PLAYER_PREFS.volumes.bgm);
    expect(snap.volumes.se).toBe(DEFAULT_PLAYER_PREFS.volumes.se);
    expect(snap.volumes.ambient).toBe(1);
    expect(snap.volumes.voice).toBe(0);
    expect(snap.muted).toBe(false);
    expect(snap.textSpeed).toBe(1);
  });

  it("端口 load 抛错时用默认值起航（不把异常抛给 boot）", async () => {
    const preferences = new PlayerPreferences({
      async load() {
        throw new Error("存储不可用");
      },
      async save() {
        /* 本组不落盘 */
      },
    });
    await expect(preferences.hydrate()).resolves.toBeUndefined();
    expect(preferences.snapshot().volumes).toEqual(
      DEFAULT_PLAYER_PREFS.volumes,
    );
  });

  it("持久化防抖尾结算：dispose 把未落盘的末次修改补发出去", async () => {
    vi.useFakeTimers();
    try {
      const port = makePort(null);
      const preferences = new PlayerPreferences(port);
      await preferences.hydrate();
      preferences.setVolume("bgm", 0.25);
      // 防抖窗没走完就收尾：末次修改必须补发，否则用户这次调的音量丢了
      preferences.dispose();
      await Promise.resolve();
      expect(port.saved).toHaveLength(1);
      expect(port.saved[0]?.volumes.bgm).toBe(0.25);
    } finally {
      vi.useRealTimers();
    }
  });

  it("音频状态键仍属保留键：宿主改音量只能走偏好，不能直写 SYS", () => {
    // 这条锁住「双向」的一侧边界：偏好是宿主唯一的音量写入口。
    // 写入失败是**返回值 false + 出站 engine.error**，不是抛异常（外部系统不该被异常打死）。
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "reserved",
        columns: [{ id: "start", kind: "flow", commands: [] }],
      }),
      { rngSeed: 1 },
    );
    const errors: string[] = [];
    engine.onEvent((event) => {
      // 出站统一信封：{v, kind:"event", payload}，判别式在 payload 上
      if (event.payload.kind === "engine.error")
        errors.push(event.payload.code);
    });
    const before = engine.get(SYS.audioBgm);
    const ok = engine.gameState.set(SYS.audioBgm, {
      kind: "play",
      resource: "x.mp3",
      volume: 1,
      loop: true,
      fadeMs: 0,
    } satisfies AudioChannelState);
    expect(ok).toBe(false);
    expect(errors).toContain("reserved-key");
    // 状态原样：拒绝是真拒绝，不是「写了再回滚」
    expect(engine.get(SYS.audioBgm)).toBe(before);
    // 正路：setScoped 走 game.<系统>.<键> 命名空间
    expect(engine.gameState.setScoped("puzzle", "score", 10)).toBe(true);
    expect(engine.get("game.puzzle.score")).toBe(10);
  });
});
