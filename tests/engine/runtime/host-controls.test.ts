/**
 * 宿主控制面：九方法逐个转调。
 *
 * 判据只认「谁被调了几次、带什么参数」——控制面自己**不该有状态**：暂停态归引擎、
 * 播放位置归端口。所以这里全部用替身：引擎与三个端口都是记着调用的空壳，
 * 断言的是转调形状，不是它们各自的行为（那几件事各自的测试另有其人）。
 */
import { describe, expect, it } from "vitest";
import type {
  AudioChannel,
  AudioPort,
  StoryEngine,
  VideoPort,
} from "@lingfan-engine/core";
import { createHostControls } from "../../../template/v1/__PROJECT__/src/host/controls";

/** 记着被调过什么的引擎替身：只实现控制面会用到的那几个方法 */
function makeEngine() {
  const calls: string[] = [];
  const engine = {
    pause(): void {
      calls.push("pause");
    },
    resume(): void {
      calls.push("resume");
    },
    paused(): boolean {
      calls.push("paused");
      return true;
    },
    navigate(columnId: string): void {
      calls.push(`navigate:${columnId}`);
    },
    save(slot: string): void {
      calls.push(`save:${slot}`);
    },
    load(slot: string): void {
      calls.push(`load:${slot}`);
    },
    dispose(): void {
      calls.push("dispose");
    },
  } as unknown as StoryEngine;
  return { engine, calls };
}

/** 记着通道与次序的音频端口替身 */
function makeAudio() {
  const calls: string[] = [];
  const port = {
    play: () => {},
    stop: () => {},
    pause(channel: AudioChannel): void {
      calls.push(`pause:${channel}`);
    },
    resume(channel: AudioChannel): void {
      calls.push(`resume:${channel}`);
    },
    position: () => 0,
    dispose: () => {},
  } as unknown as AudioPort;
  return { port, calls };
}

/** 记着调用的视频端口替身 */
function makeVideo() {
  const calls: string[] = [];
  const port = {
    play: () => {},
    pause(): void {
      calls.push("pause");
    },
    resume(): void {
      calls.push("resume");
    },
    seek: () => {},
    stop: () => {},
    dispose: () => {},
  } as unknown as VideoPort;
  return { port, calls };
}

/** 一套替身 + 由它们造出来的控制面 */
function makeHarness(audioChannels?: readonly AudioChannel[]) {
  const engine = makeEngine();
  const audio = makeAudio();
  const video = makeVideo();
  const controls = createHostControls({
    engine: () => engine.engine,
    audio: () => audio.port,
    video: () => video.port,
    audioChannels,
  });
  return { controls, engine, audio, video };
}

describe("宿主导航、存读与拆除都直接转给引擎", () => {
  it("pause / resume / paused / navigate / save / load / dispose 各调一次，参数原样传下去", () => {
    const { controls, engine, audio, video } = makeHarness();

    controls.pause();
    controls.resume();
    expect(controls.paused()).toBe(true);
    controls.navigate("forest");
    controls.save("slot-1");
    controls.load("slot-2");
    controls.dispose();

    expect(engine.calls).toEqual([
      "pause",
      "resume",
      "paused",
      "navigate:forest",
      "save:slot-1",
      "load:slot-2",
      "dispose",
    ]);
    // 引擎侧的这几件事与媒体无关：不许顺手去动端口
    expect(audio.calls).toEqual([]);
    expect(video.calls).toEqual([]);
  });
});

describe("媒体暂停与恢复的批量口径", () => {
  it("不传通道：三条常驻通道各一次 + 视频一次，`se` 不在其中", () => {
    const { controls, audio, video } = makeHarness();

    controls.pauseMedia();

    expect(audio.calls).toEqual(["pause:bgm", "pause:ambient", "pause:voice"]);
    expect(audio.calls).not.toContain("pause:se");
    expect(video.calls).toEqual(["pause"]);
  });

  it("恢复同构：三条常驻通道 + 视频，次序与暂停一致", () => {
    const { controls, audio, video } = makeHarness();

    controls.resumeMedia();

    expect(audio.calls).toEqual([
      "resume:bgm",
      "resume:ambient",
      "resume:voice",
    ]);
    expect(audio.calls).not.toContain("resume:se");
    expect(video.calls).toEqual(["resume"]);
  });

  it("点名通道只动那一条，且不碰视频", () => {
    const { controls, audio, video } = makeHarness();

    controls.pauseMedia("bgm");
    controls.resumeMedia("bgm");

    expect(audio.calls).toEqual(["pause:bgm", "resume:bgm"]);
    expect(video.calls).toEqual([]);
  });

  it("点名 `se` 静默不动作：一次性音效没有续播语义", () => {
    const { controls, audio, video } = makeHarness();

    controls.pauseMedia("se");
    controls.resumeMedia("se");

    expect(audio.calls).toEqual([]);
    expect(video.calls).toEqual([]);
  });

  it("调用方给了通道表就按它来，`se` 仍被剔除", () => {
    const { controls, audio, video } = makeHarness(["ambient", "se"]);

    controls.pauseMedia();

    expect(audio.calls).toEqual(["pause:ambient"]);
    expect(video.calls).toEqual(["pause"]);
  });
});

describe("取用函数形态：重建后仍指向新实例", () => {
  it("引擎被整体换掉后，控制面调的是新那一个", () => {
    let current = makeEngine();
    const audio = makeAudio();
    const video = makeVideo();
    const controls = createHostControls({
      engine: () => current.engine,
      audio: () => audio.port,
      video: () => video.port,
    });

    controls.pause();
    expect(current.calls).toEqual(["pause"]);

    // 重启对局：旧引擎作废，控制面对象本身不换
    const rebuilt = makeEngine();
    current = rebuilt;
    controls.pause();

    expect(rebuilt.calls).toEqual(["pause"]);
  });
});
