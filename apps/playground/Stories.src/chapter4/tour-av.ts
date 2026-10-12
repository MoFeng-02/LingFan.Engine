/** 第四章 · 声光餐车：bgm/ambient/voice 三轨 + 视频族（暂停/续播/跳帧/跳过开关）一条龙。 */
import { script } from "@lingfan/editor";

const {
  ambient,
  pauseVideo,
  resumeVideo,
  say,
  seekVideo,
  stopAmbient,
  stopBgm,
  stopVideo,
  stopVoice,
  video,
  videoSkipable,
  voice,
  wait,
} = script;

import { stationsMenu } from "../lib/stations";

export default function tour_av(): void {
  say(
    "声光餐车——BGM、环境音、配音三轨各停各的；视频支持暂停/续播/跳帧/点击跳过。",
    "灵泛",
  );
  stopBgm({ fade: 600 });
  say("stop_bgm（600ms 淡出）——序幕的夜蟋蟀退场。");
  ambient("Audio/crickets_night01.mp3", { volume: 0.4, loop: true });
  say("ambient 循环环境音进场（同一素材、不同轨、独立音量）。");
  stopAmbient();
  say("stop_ambient 收环境音——三轨互不干扰。");
  voice("Audio/chest_drawer_open.mp3", { autoStop: true });
  say("voice 播一句配音（auto_stop 播完自停）。");
  stopVoice();
  say("stop_voice 立刻收线。");
  videoSkipable(true);
  say("video_skipable(true)——下一段视频可点击跳过。");
  video("Video/m1.mp4", { volume: 0.5 });
  pauseVideo();
  say("视频已暂停（pause_video）——画面停在最后一帧。");
  resumeVideo();
  say("resume_video 续播。");
  seekVideo(4);
  say("seek_video 跳到 4 秒处继续播。");
  wait(1.5, { skipable: true });
  stopVideo();
  say("stop_video 收屏——声光餐车打烊。");
  stationsMenu();
}
