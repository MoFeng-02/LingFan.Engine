/** media 族的读向解析。 */
import { unquote } from "../../lexer.ts";
import type { StoryCommand } from "../../../../contracts/index.ts";
import type { StatementContext } from "../state.ts";

/**
 * 解析本族的 op 行（`bgm` `se` `ambient` `voice` `stop_bgm` `stop_ambient` `stop_voice` `stop_se`
 * `audio_play` `audio_stop` `audio_volume` `video` `cutscene` `seek_video` `pause_video`
 * `resume_video` `stop_video` `video_skipable`）。
 *
 * 入参是分发骨架建好的 `StatementContext`（已切好的词表、定位前缀、issue 出口与警告通道）。
 * 只处理本族的 op，不匹配时落到末尾 `return null`，由骨架决定后续。
 * 失败表现：不抛异常；语法或参数不符时用 `c.fail` 记一条带定位的 issue 并返回 `null`，
 * 由调用方按 issues 非空整次拒绝。语义暂未生效的情况记到警告通道，不阻塞解析。
 */
export function parseMediaStatement(c: StatementContext): StoryCommand | null {
  const { op, tokens, fail } = c;
  switch (op) {
    // 音频通道：resource 位置参数 + key=value 负载（volume/loop/fade/auto_stop）
    case "bgm":
    case "se":
    case "ambient":
    case "voice": {
      const resource = tokens.find((t) => t.startsWith('"'));
      if (resource === undefined) return fail(`${op} 需要 resource`);
      const cmd: StoryCommand = { op, resource: unquote(resource) };
      for (const token of tokens) {
        if (token.startsWith('"')) continue;
        const eq = token.indexOf("=");
        const key = eq < 0 ? token : token.slice(0, eq);
        const raw = eq < 0 ? "" : token.slice(eq + 1);
        if (key === "volume" || key === "fade") {
          const num = Number(raw);
          if (eq < 0 || raw === "" || Number.isNaN(num))
            return fail(`${op} 的 ${key} 需要数字`);
          cmd[key] = num;
        } else if (key === "loop" || key === "auto_stop" || key === "restart") {
          // restart 仅常驻通道可显式重播（se 恒为一次性触发）
          if (key === "restart" && op === "se")
            return fail("se 不支持 restart（一次性音效恒重播）");
          if (eq < 0 && key === "restart") {
            cmd.restart = true;
            continue;
          }
          if (raw !== "true" && raw !== "false")
            return fail(`${op} 的 ${key} 需要 true|false`);
          cmd[key] = raw === "true";
        } else {
          return fail(`${op} 未知参数：${token}`);
        }
      }
      return cmd;
    }
    case "stop_bgm":
    case "stop_ambient":
    case "stop_voice":
    case "stop_se": {
      const cmd: StoryCommand = { op };
      for (const token of tokens) {
        const eq = token.indexOf("=");
        const key = eq < 0 ? token : token.slice(0, eq);
        const raw = eq < 0 ? "" : token.slice(eq + 1);
        if (key !== "fade") return fail(`${op} 未知参数：${token}`);
        const num = Number(raw);
        if (eq < 0 || raw === "" || Number.isNaN(num))
          return fail(`${op} 的 fade 需要数字`);
        cmd.fade = num;
      }
      return cmd;
    }
    // 音频实例族：位置参数是 id（与 resource 的引号形态区分开，作者一眼能看出哪个是名字）
    case "audio_play": {
      const inst = tokens[0];
      const channel = tokens[1];
      const resource = tokens.find((t) => t.startsWith('"'));
      if (inst === undefined) return fail("audio_play 需要实例 id");
      if (channel === undefined) return fail("audio_play 需要 channel");
      if (resource === undefined) return fail("audio_play 需要 resource");
      const cmd: StoryCommand = {
        op: "audio_play",
        inst,
        channel,
        resource: unquote(resource),
      };
      for (const token of tokens) {
        if (token === inst || token === channel || token.startsWith('"'))
          continue;
        const eq = token.indexOf("=");
        const key = eq < 0 ? token : token.slice(0, eq);
        const raw = eq < 0 ? "" : token.slice(eq + 1);
        if (key === "volume" || key === "fade") {
          const num = Number(raw);
          if (eq < 0 || raw === "" || Number.isNaN(num))
            return fail(`audio_play 的 ${key} 需要数字`);
          cmd[key] = num;
        } else if (key === "loop" || key === "restart") {
          if (raw !== "true" && raw !== "false")
            return fail(`audio_play 的 ${key} 需要 true|false`);
          cmd[key] = raw === "true";
        } else {
          return fail(`audio_play 未知参数：${token}`);
        }
      }
      return cmd;
    }
    case "audio_stop": {
      const cmd: StoryCommand = { op: "audio_stop" };
      for (const token of tokens) {
        const eq = token.indexOf("=");
        if (eq < 0) {
          // 唯一的无等号位置参数是目标实例；重复给就是写错
          if (cmd.inst !== undefined)
            return fail(`audio_stop 只有一个实例位置参数：${token}`);
          cmd.inst = token;
          continue;
        }
        const key = token.slice(0, eq);
        const raw = token.slice(eq + 1);
        if (key !== "fade") return fail(`audio_stop 未知参数：${token}`);
        const num = Number(raw);
        if (raw === "" || Number.isNaN(num))
          return fail("audio_stop 的 fade 需要数字");
        cmd.fade = num;
      }
      return cmd;
    }
    case "audio_volume": {
      const inst = tokens[0];
      let volume: number | undefined;
      for (const token of tokens.slice(1)) {
        const eq = token.indexOf("=");
        const key = eq < 0 ? token : token.slice(0, eq);
        const raw = eq < 0 ? "" : token.slice(eq + 1);
        if (key !== "volume") return fail(`audio_volume 未知参数：${token}`);
        const num = Number(raw);
        if (eq < 0 || raw === "" || Number.isNaN(num))
          return fail("audio_volume 的 volume 需要数字");
        volume = num;
      }
      if (inst === undefined) return fail("audio_volume 需要实例 id");
      if (volume === undefined) return fail("audio_volume 需要 volume");
      return { op: "audio_volume", inst, volume };
    }
    // 视频族：resource 位置参数（video/cutscene）；seek_video 为秒数
    case "video":
    case "cutscene": {
      const resource = tokens.find((t) => t.startsWith('"'));
      if (resource === undefined) return fail(`${op} 需要 resource`);
      const cmd: StoryCommand = { op, resource: unquote(resource) };
      for (const token of tokens) {
        if (token.startsWith('"')) continue;
        const eq = token.indexOf("=");
        const key = eq < 0 ? token : token.slice(0, eq);
        const raw = eq < 0 ? "" : token.slice(eq + 1);
        if (key === "volume") {
          const num = Number(raw);
          if (eq < 0 || raw === "" || Number.isNaN(num))
            return fail(`${op} 的 volume 需要数字`);
          cmd.volume = num;
        } else if (key === "loop" || key === "skipable") {
          if (raw !== "true" && raw !== "false")
            return fail(`${op} 的 ${key} 需要 true|false`);
          cmd[key] = raw === "true";
        } else if (key === "z" || key === "z-index") {
          // 实例级 z（视频层）
          cmd.z = Number(raw);
        } else {
          return fail(`${op} 未知参数：${token}`);
        }
      }
      return cmd;
    }
    case "seek_video": {
      const seconds = Number(tokens[0]);
      if (tokens.length < 1 || Number.isNaN(seconds))
        return fail("seek_video 需要数字秒数");
      return { op: "seek_video", seconds } as StoryCommand;
    }
    case "pause_video":
      return { op: "pause_video" } as StoryCommand;
    case "resume_video":
      return { op: "resume_video" } as StoryCommand;
    case "stop_video":
      return { op: "stop_video" } as StoryCommand;
    case "video_skipable": {
      const raw = tokens[0];
      if (raw !== "true" && raw !== "false")
        return fail("video_skipable 需要 true|false");
      return { op: "video_skipable", value: raw === "true" } as StoryCommand;
    }
  }
  return null;
}
