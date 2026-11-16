/**
 * 域 B 锁：域 B 全部键的 zod 输出 ↔ core 负载双向可赋值 + 键集相等，
 * 加键映射锁（CommandOf 登记无遗漏）、故意错误锚与运行期校验互锁。
 *
 * 三件套缺一不可：可赋值（A/B）对单侧多余字段不敏感，键集（K）补上这一盲区；
 * 键映射锁（mapA/mapB）确认每个 op 键在 core 注册表里登记到正确负载。
 * 空负载 op（pause_video/resume_video/stop_video）用专用锁：键集判据对
 * Record<string, never> 不适用。共用负载的键（bgm/ambient、四个 stop、
 * audio_pause/resume）逐键过锁，确认各自登记而非只锁一份负载。
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AudioChannel, StoryCommand } from "@lingfan-engine/core";
import type {
  AnimateBlockOpPayload,
  AnimateOpPayload,
  AudioChannelOpPayload,
  AudioPlayOpPayload,
  AudioStopOpPayload,
  AudioVolumeOpPayload,
  BackgroundOpPayload,
  BgmOpPayload,
  BgSwitchOpPayload,
  CommandOf,
  CutsceneOpPayload,
  EmptyOpPayload,
  HideOpPayload,
  InteractionOpPayload,
  MinigameOpPayload,
  MountOpPayload,
  RewardSpec,
  SeOpPayload,
  SeekVideoOpPayload,
  ShakeOpPayload,
  ShowOpPayload,
  StopOpPayload,
  StyleOpPayload,
  TextTypewriterOpPayload,
  TransitionOpPayload,
  VideoOpPayload,
  VideoSkipableOpPayload,
  VoiceOpPayload,
  WindowOpPayload,
  ZindexOpPayload,
} from "@lingfan-engine/core/script";
import {
  animateBlockSchema,
  animateSchema,
  audioPauseSchema,
  audioPlaySchema,
  audioResumeSchema,
  audioStopSchema,
  audioVolumeSchema,
  backgroundSchema,
  bgmSchema,
  bgSwitchSchema,
  cutsceneSchema,
  emptySchema,
  hideSchema,
  interactionSchema,
  minigameSchema,
  mountSchema,
  seSchema,
  seekVideoSchema,
  shakeSchema,
  showSchema,
  stopSchema,
  styleSchema,
  textTypewriterSchema,
  transitionSchema,
  videoSchema,
  videoSkipableSchema,
  voiceSchema,
  windowSchema,
  zindexSchema,
} from "../../../packages/editor/src/schema/opSchemas/commands";
import { validateCommand } from "../../../packages/editor/src/schema/opSchemas";
import * as script from "../../../packages/editor/src/script";
import type { Assignable, SameKeys } from "./harness";

describe("域 B 锁 · 音频域", () => {
  it("bgm：A/B/K + 键映射锁", () => {
    const a: Assignable<z.infer<typeof bgmSchema>, BgmOpPayload> = true;
    const b: Assignable<BgmOpPayload, z.infer<typeof bgmSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof bgmSchema>, keyof BgmOpPayload> =
      true;
    const mapA: Assignable<
      CommandOf<"bgm">,
      { op: "bgm" } & BgmOpPayload
    > = true;
    const mapB: Assignable<
      { op: "bgm" } & BgmOpPayload,
      CommandOf<"bgm">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("stop_bgm：A/B/K + 键映射锁", () => {
    const a: Assignable<z.infer<typeof stopSchema>, StopOpPayload> = true;
    const b: Assignable<StopOpPayload, z.infer<typeof stopSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof stopSchema>, keyof StopOpPayload> =
      true;
    const mapA: Assignable<
      CommandOf<"stop_bgm">,
      { op: "stop_bgm" } & StopOpPayload
    > = true;
    const mapB: Assignable<
      { op: "stop_bgm" } & StopOpPayload,
      CommandOf<"stop_bgm">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("se：A/B/K + 键映射锁", () => {
    const a: Assignable<z.infer<typeof seSchema>, SeOpPayload> = true;
    const b: Assignable<SeOpPayload, z.infer<typeof seSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof seSchema>, keyof SeOpPayload> = true;
    const mapA: Assignable<CommandOf<"se">, { op: "se" } & SeOpPayload> = true;
    const mapB: Assignable<{ op: "se" } & SeOpPayload, CommandOf<"se">> = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("ambient：A/B/K + 键映射锁（与 bgm 共用负载，逐键登记）", () => {
    const a: Assignable<z.infer<typeof bgmSchema>, BgmOpPayload> = true;
    const b: Assignable<BgmOpPayload, z.infer<typeof bgmSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof bgmSchema>, keyof BgmOpPayload> =
      true;
    const mapA: Assignable<
      CommandOf<"ambient">,
      { op: "ambient" } & BgmOpPayload
    > = true;
    const mapB: Assignable<
      { op: "ambient" } & BgmOpPayload,
      CommandOf<"ambient">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("stop_ambient：A/B/K + 键映射锁", () => {
    const a: Assignable<z.infer<typeof stopSchema>, StopOpPayload> = true;
    const b: Assignable<StopOpPayload, z.infer<typeof stopSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof stopSchema>, keyof StopOpPayload> =
      true;
    const mapA: Assignable<
      CommandOf<"stop_ambient">,
      { op: "stop_ambient" } & StopOpPayload
    > = true;
    const mapB: Assignable<
      { op: "stop_ambient" } & StopOpPayload,
      CommandOf<"stop_ambient">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("voice：A/B/K + 键映射锁", () => {
    const a: Assignable<z.infer<typeof voiceSchema>, VoiceOpPayload> = true;
    const b: Assignable<VoiceOpPayload, z.infer<typeof voiceSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof voiceSchema>, keyof VoiceOpPayload> =
      true;
    const mapA: Assignable<
      CommandOf<"voice">,
      { op: "voice" } & VoiceOpPayload
    > = true;
    const mapB: Assignable<
      { op: "voice" } & VoiceOpPayload,
      CommandOf<"voice">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("stop_voice：A/B/K + 键映射锁", () => {
    const a: Assignable<z.infer<typeof stopSchema>, StopOpPayload> = true;
    const b: Assignable<StopOpPayload, z.infer<typeof stopSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof stopSchema>, keyof StopOpPayload> =
      true;
    const mapA: Assignable<
      CommandOf<"stop_voice">,
      { op: "stop_voice" } & StopOpPayload
    > = true;
    const mapB: Assignable<
      { op: "stop_voice" } & StopOpPayload,
      CommandOf<"stop_voice">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("stop_se：A/B/K + 键映射锁", () => {
    const a: Assignable<z.infer<typeof stopSchema>, StopOpPayload> = true;
    const b: Assignable<StopOpPayload, z.infer<typeof stopSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof stopSchema>, keyof StopOpPayload> =
      true;
    const mapA: Assignable<
      CommandOf<"stop_se">,
      { op: "stop_se" } & StopOpPayload
    > = true;
    const mapB: Assignable<
      { op: "stop_se" } & StopOpPayload,
      CommandOf<"stop_se">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("audio_play：A/B/K + 键映射锁", () => {
    const a: Assignable<
      z.infer<typeof audioPlaySchema>,
      AudioPlayOpPayload
    > = true;
    const b: Assignable<
      AudioPlayOpPayload,
      z.infer<typeof audioPlaySchema>
    > = true;
    const k: SameKeys<
      keyof z.infer<typeof audioPlaySchema>,
      keyof AudioPlayOpPayload
    > = true;
    const mapA: Assignable<
      CommandOf<"audio_play">,
      { op: "audio_play" } & AudioPlayOpPayload
    > = true;
    const mapB: Assignable<
      { op: "audio_play" } & AudioPlayOpPayload,
      CommandOf<"audio_play">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("audio_stop：A/B/K + 键映射锁", () => {
    const a: Assignable<
      z.infer<typeof audioStopSchema>,
      AudioStopOpPayload
    > = true;
    const b: Assignable<
      AudioStopOpPayload,
      z.infer<typeof audioStopSchema>
    > = true;
    const k: SameKeys<
      keyof z.infer<typeof audioStopSchema>,
      keyof AudioStopOpPayload
    > = true;
    const mapA: Assignable<
      CommandOf<"audio_stop">,
      { op: "audio_stop" } & AudioStopOpPayload
    > = true;
    const mapB: Assignable<
      { op: "audio_stop" } & AudioStopOpPayload,
      CommandOf<"audio_stop">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("audio_volume：A/B/K + 键映射锁", () => {
    const a: Assignable<
      z.infer<typeof audioVolumeSchema>,
      AudioVolumeOpPayload
    > = true;
    const b: Assignable<
      AudioVolumeOpPayload,
      z.infer<typeof audioVolumeSchema>
    > = true;
    const k: SameKeys<
      keyof z.infer<typeof audioVolumeSchema>,
      keyof AudioVolumeOpPayload
    > = true;
    const mapA: Assignable<
      CommandOf<"audio_volume">,
      { op: "audio_volume" } & AudioVolumeOpPayload
    > = true;
    const mapB: Assignable<
      { op: "audio_volume" } & AudioVolumeOpPayload,
      CommandOf<"audio_volume">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("audio_pause：A/B/K + 键映射锁", () => {
    const a: Assignable<
      z.infer<typeof audioPauseSchema>,
      AudioChannelOpPayload
    > = true;
    const b: Assignable<
      AudioChannelOpPayload,
      z.infer<typeof audioPauseSchema>
    > = true;
    const k: SameKeys<
      keyof z.infer<typeof audioPauseSchema>,
      keyof AudioChannelOpPayload
    > = true;
    const mapA: Assignable<
      CommandOf<"audio_pause">,
      { op: "audio_pause" } & AudioChannelOpPayload
    > = true;
    const mapB: Assignable<
      { op: "audio_pause" } & AudioChannelOpPayload,
      CommandOf<"audio_pause">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("audio_resume：A/B/K + 键映射锁（与 audio_pause 共用负载，逐键登记）", () => {
    const a: Assignable<
      z.infer<typeof audioResumeSchema>,
      AudioChannelOpPayload
    > = true;
    const b: Assignable<
      AudioChannelOpPayload,
      z.infer<typeof audioResumeSchema>
    > = true;
    const k: SameKeys<
      keyof z.infer<typeof audioResumeSchema>,
      keyof AudioChannelOpPayload
    > = true;
    const mapA: Assignable<
      CommandOf<"audio_resume">,
      { op: "audio_resume" } & AudioChannelOpPayload
    > = true;
    const mapB: Assignable<
      { op: "audio_resume" } & AudioChannelOpPayload,
      CommandOf<"audio_resume">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });
});

describe("域 B 锁 · 视频域", () => {
  it("video：A/B/K + 键映射锁", () => {
    const a: Assignable<z.infer<typeof videoSchema>, VideoOpPayload> = true;
    const b: Assignable<VideoOpPayload, z.infer<typeof videoSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof videoSchema>, keyof VideoOpPayload> =
      true;
    const mapA: Assignable<
      CommandOf<"video">,
      { op: "video" } & VideoOpPayload
    > = true;
    const mapB: Assignable<
      { op: "video" } & VideoOpPayload,
      CommandOf<"video">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("cutscene：A/B/K + 键映射锁", () => {
    const a: Assignable<
      z.infer<typeof cutsceneSchema>,
      CutsceneOpPayload
    > = true;
    const b: Assignable<
      CutsceneOpPayload,
      z.infer<typeof cutsceneSchema>
    > = true;
    const k: SameKeys<
      keyof z.infer<typeof cutsceneSchema>,
      keyof CutsceneOpPayload
    > = true;
    const mapA: Assignable<
      CommandOf<"cutscene">,
      { op: "cutscene" } & CutsceneOpPayload
    > = true;
    const mapB: Assignable<
      { op: "cutscene" } & CutsceneOpPayload,
      CommandOf<"cutscene">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("seek_video：A/B/K + 键映射锁", () => {
    const a: Assignable<
      z.infer<typeof seekVideoSchema>,
      SeekVideoOpPayload
    > = true;
    const b: Assignable<
      SeekVideoOpPayload,
      z.infer<typeof seekVideoSchema>
    > = true;
    const k: SameKeys<
      keyof z.infer<typeof seekVideoSchema>,
      keyof SeekVideoOpPayload
    > = true;
    const mapA: Assignable<
      CommandOf<"seek_video">,
      { op: "seek_video" } & SeekVideoOpPayload
    > = true;
    const mapB: Assignable<
      { op: "seek_video" } & SeekVideoOpPayload,
      CommandOf<"seek_video">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("video_skipable：A/B/K + 键映射锁", () => {
    const a: Assignable<
      z.infer<typeof videoSkipableSchema>,
      VideoSkipableOpPayload
    > = true;
    const b: Assignable<
      VideoSkipableOpPayload,
      z.infer<typeof videoSkipableSchema>
    > = true;
    const k: SameKeys<
      keyof z.infer<typeof videoSkipableSchema>,
      keyof VideoSkipableOpPayload
    > = true;
    const mapA: Assignable<
      CommandOf<"video_skipable">,
      { op: "video_skipable" } & VideoSkipableOpPayload
    > = true;
    const mapB: Assignable<
      { op: "video_skipable" } & VideoSkipableOpPayload,
      CommandOf<"video_skipable">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("pause_video：空负载锁（schema 零字段 + CommandOf 特判双向）", () => {
    const e: Assignable<z.infer<typeof emptySchema>, EmptyOpPayload> = true;
    const c1: Assignable<
      CommandOf<"pause_video">,
      { op: "pause_video" }
    > = true;
    const c2: Assignable<
      { op: "pause_video" },
      CommandOf<"pause_video">
    > = true;
    void e;
    void c1;
    void c2;
  });

  it("resume_video：空负载锁（schema 零字段 + CommandOf 特判双向）", () => {
    const e: Assignable<z.infer<typeof emptySchema>, EmptyOpPayload> = true;
    const c1: Assignable<
      CommandOf<"resume_video">,
      { op: "resume_video" }
    > = true;
    const c2: Assignable<
      { op: "resume_video" },
      CommandOf<"resume_video">
    > = true;
    void e;
    void c1;
    void c2;
  });

  it("stop_video：空负载锁（schema 零字段 + CommandOf 特判双向）", () => {
    const e: Assignable<z.infer<typeof emptySchema>, EmptyOpPayload> = true;
    const c1: Assignable<CommandOf<"stop_video">, { op: "stop_video" }> = true;
    const c2: Assignable<{ op: "stop_video" }, CommandOf<"stop_video">> = true;
    void e;
    void c1;
    void c2;
  });
});

describe("域 B 锁 · 元素域", () => {
  it("show：A/B/K + 键映射锁", () => {
    const a: Assignable<z.infer<typeof showSchema>, ShowOpPayload> = true;
    const b: Assignable<ShowOpPayload, z.infer<typeof showSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof showSchema>, keyof ShowOpPayload> =
      true;
    const mapA: Assignable<
      CommandOf<"show">,
      { op: "show" } & ShowOpPayload
    > = true;
    const mapB: Assignable<
      { op: "show" } & ShowOpPayload,
      CommandOf<"show">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("hide：A/B/K + 键映射锁", () => {
    const a: Assignable<z.infer<typeof hideSchema>, HideOpPayload> = true;
    const b: Assignable<HideOpPayload, z.infer<typeof hideSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof hideSchema>, keyof HideOpPayload> =
      true;
    const mapA: Assignable<
      CommandOf<"hide">,
      { op: "hide" } & HideOpPayload
    > = true;
    const mapB: Assignable<
      { op: "hide" } & HideOpPayload,
      CommandOf<"hide">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("background：A/B/K + 键映射锁", () => {
    const a: Assignable<
      z.infer<typeof backgroundSchema>,
      BackgroundOpPayload
    > = true;
    const b: Assignable<
      BackgroundOpPayload,
      z.infer<typeof backgroundSchema>
    > = true;
    const k: SameKeys<
      keyof z.infer<typeof backgroundSchema>,
      keyof BackgroundOpPayload
    > = true;
    const mapA: Assignable<
      CommandOf<"background">,
      { op: "background" } & BackgroundOpPayload
    > = true;
    const mapB: Assignable<
      { op: "background" } & BackgroundOpPayload,
      CommandOf<"background">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("bg_switch：A/B/K + 键映射锁", () => {
    const a: Assignable<
      z.infer<typeof bgSwitchSchema>,
      BgSwitchOpPayload
    > = true;
    const b: Assignable<
      BgSwitchOpPayload,
      z.infer<typeof bgSwitchSchema>
    > = true;
    const k: SameKeys<
      keyof z.infer<typeof bgSwitchSchema>,
      keyof BgSwitchOpPayload
    > = true;
    const mapA: Assignable<
      CommandOf<"bg_switch">,
      { op: "bg_switch" } & BgSwitchOpPayload
    > = true;
    const mapB: Assignable<
      { op: "bg_switch" } & BgSwitchOpPayload,
      CommandOf<"bg_switch">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("zindex：A/B/K + 键映射锁", () => {
    const a: Assignable<z.infer<typeof zindexSchema>, ZindexOpPayload> = true;
    const b: Assignable<ZindexOpPayload, z.infer<typeof zindexSchema>> = true;
    const k: SameKeys<
      keyof z.infer<typeof zindexSchema>,
      keyof ZindexOpPayload
    > = true;
    const mapA: Assignable<
      CommandOf<"zindex">,
      { op: "zindex" } & ZindexOpPayload
    > = true;
    const mapB: Assignable<
      { op: "zindex" } & ZindexOpPayload,
      CommandOf<"zindex">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("style：A/B/K + 键映射锁", () => {
    const a: Assignable<z.infer<typeof styleSchema>, StyleOpPayload> = true;
    const b: Assignable<StyleOpPayload, z.infer<typeof styleSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof styleSchema>, keyof StyleOpPayload> =
      true;
    const mapA: Assignable<
      CommandOf<"style">,
      { op: "style" } & StyleOpPayload
    > = true;
    const mapB: Assignable<
      { op: "style" } & StyleOpPayload,
      CommandOf<"style">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("window：A/B/K + 键映射锁", () => {
    const a: Assignable<z.infer<typeof windowSchema>, WindowOpPayload> = true;
    const b: Assignable<WindowOpPayload, z.infer<typeof windowSchema>> = true;
    const k: SameKeys<
      keyof z.infer<typeof windowSchema>,
      keyof WindowOpPayload
    > = true;
    const mapA: Assignable<
      CommandOf<"window">,
      { op: "window" } & WindowOpPayload
    > = true;
    const mapB: Assignable<
      { op: "window" } & WindowOpPayload,
      CommandOf<"window">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("animate：A/B/K + 键映射锁", () => {
    const a: Assignable<z.infer<typeof animateSchema>, AnimateOpPayload> = true;
    const b: Assignable<AnimateOpPayload, z.infer<typeof animateSchema>> = true;
    const k: SameKeys<
      keyof z.infer<typeof animateSchema>,
      keyof AnimateOpPayload
    > = true;
    const mapA: Assignable<
      CommandOf<"animate">,
      { op: "animate" } & AnimateOpPayload
    > = true;
    const mapB: Assignable<
      { op: "animate" } & AnimateOpPayload,
      CommandOf<"animate">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("animate_block：A/B/K + 键映射锁", () => {
    const a: Assignable<
      z.infer<typeof animateBlockSchema>,
      AnimateBlockOpPayload
    > = true;
    const b: Assignable<
      AnimateBlockOpPayload,
      z.infer<typeof animateBlockSchema>
    > = true;
    const k: SameKeys<
      keyof z.infer<typeof animateBlockSchema>,
      keyof AnimateBlockOpPayload
    > = true;
    const mapA: Assignable<
      CommandOf<"animate_block">,
      { op: "animate_block" } & AnimateBlockOpPayload
    > = true;
    const mapB: Assignable<
      { op: "animate_block" } & AnimateBlockOpPayload,
      CommandOf<"animate_block">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("transition：A/B/K + 键映射锁", () => {
    const a: Assignable<
      z.infer<typeof transitionSchema>,
      TransitionOpPayload
    > = true;
    const b: Assignable<
      TransitionOpPayload,
      z.infer<typeof transitionSchema>
    > = true;
    const k: SameKeys<
      keyof z.infer<typeof transitionSchema>,
      keyof TransitionOpPayload
    > = true;
    const mapA: Assignable<
      CommandOf<"transition">,
      { op: "transition" } & TransitionOpPayload
    > = true;
    const mapB: Assignable<
      { op: "transition" } & TransitionOpPayload,
      CommandOf<"transition">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("shake：A/B/K + 键映射锁", () => {
    const a: Assignable<z.infer<typeof shakeSchema>, ShakeOpPayload> = true;
    const b: Assignable<ShakeOpPayload, z.infer<typeof shakeSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof shakeSchema>, keyof ShakeOpPayload> =
      true;
    const mapA: Assignable<
      CommandOf<"shake">,
      { op: "shake" } & ShakeOpPayload
    > = true;
    const mapB: Assignable<
      { op: "shake" } & ShakeOpPayload,
      CommandOf<"shake">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("text_typewriter：A/B/K + 键映射锁", () => {
    const a: Assignable<
      z.infer<typeof textTypewriterSchema>,
      TextTypewriterOpPayload
    > = true;
    const b: Assignable<
      TextTypewriterOpPayload,
      z.infer<typeof textTypewriterSchema>
    > = true;
    const k: SameKeys<
      keyof z.infer<typeof textTypewriterSchema>,
      keyof TextTypewriterOpPayload
    > = true;
    const mapA: Assignable<
      CommandOf<"text_typewriter">,
      { op: "text_typewriter" } & TextTypewriterOpPayload
    > = true;
    const mapB: Assignable<
      { op: "text_typewriter" } & TextTypewriterOpPayload,
      CommandOf<"text_typewriter">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });
});

describe("域 B 锁 · 玩法域", () => {
  it("minigame：A/B/K + 键映射锁", () => {
    const a: Assignable<
      z.infer<typeof minigameSchema>,
      MinigameOpPayload
    > = true;
    const b: Assignable<
      MinigameOpPayload,
      z.infer<typeof minigameSchema>
    > = true;
    const k: SameKeys<
      keyof z.infer<typeof minigameSchema>,
      keyof MinigameOpPayload
    > = true;
    const mapA: Assignable<
      CommandOf<"minigame">,
      { op: "minigame" } & MinigameOpPayload
    > = true;
    const mapB: Assignable<
      { op: "minigame" } & MinigameOpPayload,
      CommandOf<"minigame">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("interaction：A/B/K + 键映射锁", () => {
    const a: Assignable<
      z.infer<typeof interactionSchema>,
      InteractionOpPayload
    > = true;
    const b: Assignable<
      InteractionOpPayload,
      z.infer<typeof interactionSchema>
    > = true;
    const k: SameKeys<
      keyof z.infer<typeof interactionSchema>,
      keyof InteractionOpPayload
    > = true;
    const mapA: Assignable<
      CommandOf<"interaction">,
      { op: "interaction" } & InteractionOpPayload
    > = true;
    const mapB: Assignable<
      { op: "interaction" } & InteractionOpPayload,
      CommandOf<"interaction">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });

  it("RewardSpec ↔ minigame reward 元素（嵌套 spec 形状）", () => {
    type RewardElement = NonNullable<
      z.infer<typeof minigameSchema>["reward"]
    >[number];
    const a: Assignable<RewardElement, RewardSpec> = true;
    const b: Assignable<RewardSpec, RewardElement> = true;
    const k: SameKeys<keyof RewardElement, keyof RewardSpec> = true;
    void a;
    void b;
    void k;
  });
});

describe("域 B 锁 · 挂载 UI", () => {
  it("mount：A/B/K + 键映射锁", () => {
    const a: Assignable<z.infer<typeof mountSchema>, MountOpPayload> = true;
    const b: Assignable<MountOpPayload, z.infer<typeof mountSchema>> = true;
    const k: SameKeys<keyof z.infer<typeof mountSchema>, keyof MountOpPayload> =
      true;
    const mapA: Assignable<
      CommandOf<"mount">,
      { op: "mount" } & MountOpPayload
    > = true;
    const mapB: Assignable<
      { op: "mount" } & MountOpPayload,
      CommandOf<"mount">
    > = true;
    void a;
    void b;
    void k;
    void mapA;
    void mapB;
  });
});

describe("域 B 锁 · 复用与嵌套", () => {
  it("AudioChannel 复用 contracts：channel 字段 ↔ 引擎通道联合（不重声明）", () => {
    const playA: Assignable<
      z.infer<typeof audioPlaySchema>["channel"],
      AudioChannel
    > = true;
    const playB: Assignable<
      AudioChannel,
      z.infer<typeof audioPlaySchema>["channel"]
    > = true;
    const pauseA: Assignable<
      NonNullable<z.infer<typeof audioPauseSchema>["channel"]>,
      AudioChannel
    > = true;
    const pauseB: Assignable<
      AudioChannel,
      NonNullable<z.infer<typeof audioPauseSchema>["channel"]>
    > = true;
    void playA;
    void playB;
    void pauseA;
    void pauseB;
  });
});

describe("域 B 锁 · 故意错误锚", () => {
  it("缺必填 / 未知字段 / 值类型错 / 枚举错必须红", () => {
    // @ts-expect-error bgm 缺必填 resource
    const missingBgm: CommandOf<"bgm"> = { op: "bgm" };
    // @ts-expect-error show 缺必填 target
    const missingShow: CommandOf<"show"> = { op: "show" };
    // @ts-expect-error minigame 缺必填 game
    const missingGame: CommandOf<"minigame"> = { op: "minigame" };
    // @ts-expect-error mount 缺必填 visible
    const missingVisible: CommandOf<"mount"> = { op: "mount", name: "hub" };
    const ghostHide: CommandOf<"hide"> = {
      op: "hide",
      target: "guide",
      // @ts-expect-error hide 无 ghost 字段
      ghost: 1,
    };
    const wrongVolume: CommandOf<"audio_volume"> = {
      op: "audio_volume",
      inst: "rain",
      // @ts-expect-error volume 必须是 number
      volume: "loud",
    };
    const wrongSeconds: CommandOf<"seek_video"> = {
      op: "seek_video",
      // @ts-expect-error seconds 必须是 number
      seconds: "3",
    };
    const badChannel: CommandOf<"audio_play"> = {
      op: "audio_play",
      inst: "rain",
      // @ts-expect-error channel 只收四通道字面量
      channel: "bogus",
      resource: "audio/rain.ogg",
    };
    const badMode: CommandOf<"window"> = {
      op: "window",
      // @ts-expect-error mode 只收 auto/show/hide
      mode: "bogus",
    };
    void missingBgm;
    void missingShow;
    void missingGame;
    void missingVisible;
    void ghostHide;
    void wrongVolume;
    void wrongSeconds;
    void badChannel;
    void badMode;
  });

  it("空负载多字段 / x-y 联合 / reward 与 props 值面 / interaction 无 reward 必须红", () => {
    const extraPause: CommandOf<"pause_video"> = {
      op: "pause_video",
      // @ts-expect-error 空负载不收任何字段
      seconds: 1,
    };
    const badX: CommandOf<"show"> = {
      op: "show",
      target: "guide",
      // @ts-expect-error x 收 number|string，不收 boolean
      x: true,
    };
    const badReward: CommandOf<"minigame"> = {
      op: "minigame",
      game: "cook",
      reward: [
        {
          key: "coin",
          // @ts-expect-error reward value 是 ScriptValue，不收 null
          value: null,
        },
      ],
    };
    const rewardOnInteraction: CommandOf<"interaction"> = {
      op: "interaction",
      system: "walk",
      // @ts-expect-error interaction 无 reward 字段（小游戏专属）
      reward: [{ key: "coin", value: 1 }],
    };
    const badStyle: CommandOf<"style"> = {
      op: "style",
      target: "guide",
      props: {
        // @ts-expect-error props 值是 ScriptValue，不收 null
        opacity: null,
      },
    };
    void extraPause;
    void badX;
    void badReward;
    void rewardOnInteraction;
    void badStyle;
  });
});

describe("域 B 锁 · 运行期互锁", () => {
  it("域 B 词函数产物全部通过 validateCommand", () => {
    const commands: StoryCommand[] = [
      script.bgm("audio/town.mp3", { fade: 1000 }),
      script.stopBgm({ fade: 500 }),
      script.se("audio/door.ogg", { volume: 0.8 }),
      script.ambient("audio/rain.ogg"),
      script.stopAmbient(),
      script.voice("audio/line.ogg", { autoStop: false, volume: 0.9 }),
      script.stopVoice(),
      script.stopSe({ fade: 200 }),
      script.audioPlay("rain", "ambient", "audio/rain.ogg", { volume: 0.3 }),
      script.audioStop("rain", { fade: 300 }),
      script.audioVolume("rain", 0.6),
      script.audioPause({ channel: "bgm" }),
      script.audioResume(),
      script.video("video/opening.mp4", { loop: true }),
      script.cutscene("video/intro.mp4", { skipable: true }),
      script.seekVideo(12.5),
      script.pauseVideo(),
      script.resumeVideo(),
      script.stopVideo(),
      script.videoSkipable(true),
      script.show("images/npc.png", { x: "30%", y: 40, id: "guide" }),
      script.hide("guide"),
      script.background("images/inn.png"),
      script.bgSwitch("images/night.png"),
      script.setZ("guide", 5),
      script.style("guide", { opacity: 0.6 }),
      script.dialogWindow("hide"),
      script.animate("guide", "x", 300, { duration: 0.5 }),
      script.animateBlock("guide", { x: 300, opacity: 1, duration: 0.6 }),
      script.transition("fade", 0.8),
      script.shake({ intensity: 12 }),
      script.textTypewriter({ enabled: true, speed: 30 }),
      script.minigame("cook", {
        reward: [script.reward("coin", "+= 20")],
        onSuccess: "dish_done",
      }),
      script.interaction("walk", { onSuccess: "arrived" }),
      script.mount({ face: "uis", name: "hub" }, true),
    ];
    expect(commands).toHaveLength(35);
    for (const cmd of commands) {
      expect(validateCommand(cmd)).toEqual([]);
    }
  });

  it("undefined 字段不写入：最小产物只含必填", () => {
    expect(script.bgm("audio/town.mp3")).toEqual({
      op: "bgm",
      resource: "audio/town.mp3",
    });
    expect(script.video("video/opening.mp4")).toEqual({
      op: "video",
      resource: "video/opening.mp4",
    });
    expect(script.audioStop()).toEqual({ op: "audio_stop" });
    expect("volume" in script.bgm("audio/town.mp3")).toBe(false);
  });

  it("空负载产物只含 op：pause_video / resume_video / stop_video", () => {
    expect(script.pauseVideo()).toEqual({ op: "pause_video" });
    expect(script.resumeVideo()).toEqual({ op: "resume_video" });
    expect(script.stopVideo()).toEqual({ op: "stop_video" });
  });

  it("校验器诊断码：missing-required / unknown-field / invalid-value", () => {
    const missing: StoryCommand = { op: "bgm" };
    const unknown: StoryCommand = { op: "hide", target: "guide", ghost: 1 };
    const invalid: StoryCommand = { op: "seek_video", seconds: -1 };
    expect(validateCommand(missing)[0]?.code).toBe("missing-required");
    expect(validateCommand(unknown)[0]?.code).toBe("unknown-field");
    expect(validateCommand(invalid)[0]?.code).toBe("invalid-value");
  });
});
