/** media 族的读向解析。 */
import { unquote } from "../../lexer.ts";
import { isAudioChannel } from "../../../../shared/index.ts";
import type { StoryCommand } from "../../../../contracts/index.ts";
import type { StatementContext } from "../state.ts";

/**
 * 解析本族的 op 行（`bgm` `se` `ambient` `voice` `stop_bgm` `stop_ambient` `stop_voice` `stop_se`
 * `audio_play` `audio_stop` `audio_volume` `audio_pause` `audio_resume` `audio_seek` `video` `cutscene`
 * `seek_video` `pause_video` `resume_video` `stop_video` `video_skipable`）。
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
      const cmd: StoryCommand = { op: "audio_volume" };
      // 首 token 带等号 = 纯 key=value 形态（channel=… / inst=… volume=…）；
      // 否则首 token 是位置实例 id（兼容旧写法）
      const positional = tokens[0] !== undefined && !tokens[0].includes("=");
      if (positional) cmd.inst = tokens[0];
      for (const token of positional ? tokens.slice(1) : tokens) {
        const eq = token.indexOf("=");
        const key = eq < 0 ? token : token.slice(0, eq);
        const raw = eq < 0 ? "" : token.slice(eq + 1);
        if (key === "volume") {
          const num = Number(raw);
          if (eq < 0 || raw === "" || Number.isNaN(num))
            return fail("audio_volume 的 volume 需要数字");
          cmd.volume = num;
        } else if (key === "channel") {
          if (eq < 0 || !isAudioChannel(raw))
            return fail(
              `audio_volume 的 channel 不合法：${raw}（须为 bgm / se / ambient / voice 之一）`,
            );
          cmd.channel = raw;
        } else if (key === "inst") {
          if (eq < 0 || raw === "")
            return fail("audio_volume 的 inst 需要实例 id");
          cmd.inst = raw;
        } else {
          return fail(`audio_volume 未知参数：${token}`);
        }
      }
      if (cmd.inst !== undefined && cmd.channel !== undefined)
        return fail("audio_volume 的 inst 与 channel 互斥（恰好给一个）");
      if (cmd.inst === undefined && cmd.channel === undefined)
        return fail("audio_volume 需要 inst 或 channel");
      if (cmd.volume === undefined) return fail("audio_volume 需要 volume");
      return cmd;
    }
    case "audio_seek": {
      const cmd: StoryCommand = { op: "audio_seek" };
      let seconds: number | undefined;
      for (const token of tokens) {
        const eq = token.indexOf("=");
        if (eq < 0) {
          // 唯一的无等号位置参数是目标秒数
          if (seconds !== undefined)
            return fail(`audio_seek 只有一个秒数位置参数：${token}`);
          const num = Number(token);
          if (token === "" || Number.isNaN(num))
            return fail("audio_seek 需要数字秒数");
          seconds = num;
          continue;
        }
        const key = token.slice(0, eq);
        const raw = token.slice(eq + 1);
        if (key === "inst") {
          if (raw === "") return fail("audio_seek 的 inst 需要实例 id");
          cmd.inst = raw;
        } else if (key === "channel") {
          if (!isAudioChannel(raw))
            return fail(
              `audio_seek 的 channel 不合法：${raw}（须为 bgm / se / ambient / voice 之一）`,
            );
          cmd.channel = raw;
        } else {
          return fail(`audio_seek 未知参数：${token}`);
        }
      }
      if (seconds === undefined) return fail("audio_seek 需要秒数");
      if (cmd.inst !== undefined && cmd.channel !== undefined)
        return fail("audio_seek 的 inst 与 channel 互斥（恰好给一个）");
      if (cmd.inst === undefined && cmd.channel === undefined)
        return fail("audio_seek 需要 inst 或 channel");
      cmd.seconds = seconds;
      return cmd;
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
        } else if (key === "loop" || key === "skipable" || key === "restart") {
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
    case "audio_pause":
    case "audio_resume": {
      // 位置参数 = channel（兼容旧写法）；inst=… 点名单实例；都不写 = 全部常驻通道
      const cmd: StoryCommand = { op };
      for (const token of tokens) {
        const eq = token.indexOf("=");
        if (eq < 0) {
          if (cmd.channel !== undefined || cmd.inst !== undefined)
            return fail(`${op} 只接受一个目标参数`);
          if (!isAudioChannel(token))
            return fail(
              `${op} 的 channel 不合法：${token}（须为 bgm / se / ambient / voice 之一）`,
            );
          cmd.channel = token;
          continue;
        }
        const key = token.slice(0, eq);
        const raw = token.slice(eq + 1);
        if (key === "inst") {
          if (raw === "") return fail(`${op} 的 inst 需要实例 id`);
          cmd.inst = raw;
        } else if (key === "channel") {
          if (!isAudioChannel(raw))
            return fail(
              `${op} 的 channel 不合法：${raw}（须为 bgm / se / ambient / voice 之一）`,
            );
          cmd.channel = raw;
        } else {
          return fail(`${op} 未知参数：${token}`);
        }
      }
      if (cmd.inst !== undefined && cmd.channel !== undefined)
        return fail(`${op} 的 inst 与 channel 互斥（恰好给一个）`);
      return cmd;
    }
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
