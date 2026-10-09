/** present 族的读向解析。 */
import { parseElementAttrValue } from "../element";
import { parseDictLiteral, extractKeyedDictLiteral } from "../../literals";
import { unquote, splitTokens } from "../../lexer";
import { StoryCommand } from "../../../../contracts";
import { StatementContext } from "../state";

/**
 * 解析本族的 op 行（`show` `hide` `background` `bg_switch` `zindex` `style` `window` `animate` `animate_block` `transition` `shake` `text_typewriter`）。
 *
 * 入参是分发骨架建好的 `StatementContext`（已切好的词表、定位前缀、issue 出口与警告通道）。
 * 只处理本族的 op，不匹配时落到末尾 `return null`，由骨架决定后续。
 * 失败表现：不抛异常；语法或参数不符时用 `c.fail` 记一条带定位的 issue 并返回 `null`，
 * 由调用方按 issues 非空整次拒绝。语义暂未生效的情况记到警告通道，不阻塞解析。
 */
export function parsePresentStatement(c: StatementContext): StoryCommand | null {
  const { op, rest, tokens, fail } = c;
  switch (op) {
    // ====== 元素增删改 ======
    case "show": {
      const positional = tokens[0];
      if (positional === undefined || !positional.startsWith('"'))
        return fail("show 需要资源路径字符串（写入 target → source）");
      const cmd: StoryCommand = { op: "show", target: unquote(positional) };
      for (const token of tokens.slice(1)) {
        const eq = token.indexOf("=");
        if (eq <= 0) return fail(`show 未知参数：${token}`);
        const key = token.slice(0, eq);
        const raw = token.slice(eq + 1);
        if (key === "x" || key === "y") {
          cmd[key] = parseElementAttrValue(raw); // 数字或 CSS 长度串
          continue;
        }
        if (key === "id" || key === "name") {
          cmd[key] = unquote(raw);
          continue;
        }
        if (key === "background") {
          if (raw !== "true" && raw !== "false")
            return fail("show.background 需要 true|false");
          cmd.background = raw === "true";
          continue;
        }
        return fail(`show 未知参数：${key}`);
      }
      return cmd;
    }
    case "hide": {
      const target = tokens[0];
      if (target === undefined || !target.startsWith('"'))
        return fail("hide 需要目标字符串（id / name / source 任一）");
      if (tokens.length > 1) return fail(`hide 未知参数：${tokens[1]}`);
      return { op: "hide", target: unquote(target) } as StoryCommand;
    }
    case "background":
    case "bg_switch": {
      const resource = tokens[0];
      if (resource === undefined || !resource.startsWith('"'))
        return fail(`${op} 需要资源路径字符串`);
      if (tokens.length > 1) return fail(`${op} 未知参数：${tokens[1]}`);
      return { op, resource: unquote(resource) } as StoryCommand;
    }
    case "zindex": {
      const target = tokens[0];
      if (target === undefined || !target.startsWith('"'))
        return fail("zindex 需要目标字符串");
      const token = tokens[1];
      if (token === undefined || !token.startsWith("value="))
        return fail("zindex 需要 value=数字");
      const value = Number(token.slice("value=".length));
      if (Number.isNaN(value)) return fail("zindex.value 必须为数字");
      if (tokens.length > 2) return fail(`zindex 未知参数：${tokens[2]}`);
      return { op: "zindex", target: unquote(target), value } as StoryCommand;
    }
    case "style": {
      const dict = extractKeyedDictLiteral(rest, "props");
      if (dict === null) return fail("style 需要 props={…}");
      const target = splitTokens(dict.remainder)[0] ?? "";
      if (!target.startsWith('"')) return fail("style 需要目标字符串");
      return {
        op: "style",
        target: unquote(target),
        props: parseDictLiteral(dict.literal),
      } as StoryCommand;
    }
    case "window": {
      const mode = tokens[0];
      if (mode !== "auto" && mode !== "show" && mode !== "hide")
        return fail("window 需要 auto|show|hide");
      if (tokens.length > 1) return fail(`window 未知参数：${tokens[1]}`);
      return { op: "window", mode } as StoryCommand;
    }
    // ====== 帧驱动表现 ======
    case "animate": {
      const target = tokens[0];
      if (target === undefined || !target.startsWith('"'))
        return fail("animate 需要目标字符串");
      const cmd: StoryCommand = { op: "animate", target: unquote(target) };
      for (const token of tokens.slice(1)) {
        const eq = token.indexOf("=");
        if (eq <= 0) return fail(`animate 未知参数：${token}`);
        const key = token.slice(0, eq);
        const raw = token.slice(eq + 1);
        if (key === "property") {
          cmd.property = unquote(raw);
          continue;
        }
        if (key === "easing") {
          cmd.easing = unquote(raw);
          continue;
        }
        if (key === "value" || key === "duration") {
          const n = Number(raw);
          if (Number.isNaN(n)) return fail(`animate.${key} 必须为数字`);
          cmd[key] = n;
          continue;
        }
        return fail(`animate 未知参数：${key}`);
      }
      if (cmd.property === undefined) return fail("animate 需要 property=属性名");
      if (cmd.value === undefined) return fail("animate 需要 value=数字");
      return cmd;
    }
    case "animate_block": {
      const target = tokens[0];
      if (target === undefined || !target.startsWith('"'))
        return fail("animate_block 需要目标字符串");
      const cmd: StoryCommand = { op: "animate_block", target: unquote(target) };
      for (const token of tokens.slice(1)) {
        const eq = token.indexOf("=");
        if (eq <= 0) return fail(`animate_block 未知参数：${token}`);
        const key = token.slice(0, eq);
        const raw = token.slice(eq + 1);
        if (key === "easing") {
          cmd.easing = unquote(raw);
          continue;
        }
        if (
          key === "x" ||
          key === "y" ||
          key === "opacity" ||
          key === "rotation" ||
          key === "scale" ||
          key === "duration"
        ) {
          const n = Number(raw);
          if (Number.isNaN(n)) return fail(`animate_block.${key} 必须为数字`);
          cmd[key] = n;
          continue;
        }
        return fail(`animate_block 未知参数：${key}`);
      }
      if (
        cmd.x === undefined &&
        cmd.y === undefined &&
        cmd.opacity === undefined &&
        cmd.rotation === undefined &&
        cmd.scale === undefined
      )
        return fail(
          "animate_block 至少需要一个属性（x/y/opacity/rotation/scale）",
        );
      return cmd;
    }
    case "transition": {
      const type = tokens[0];
      if (type === undefined || !type.startsWith('"'))
        return fail("transition 需要效果名字符串");
      const cmd: StoryCommand = { op: "transition", type: unquote(type) };
      for (const token of tokens.slice(1)) {
        const eq = token.indexOf("=");
        if (eq <= 0) return fail(`transition 未知参数：${token}`);
        const key = token.slice(0, eq);
        if (key !== "duration") return fail(`transition 未知参数：${key}`);
        const n = Number(token.slice(eq + 1));
        if (Number.isNaN(n)) return fail("transition.duration 必须为数字");
        cmd.duration = n;
      }
      return cmd;
    }
    case "shake": {
      const cmd: StoryCommand = { op: "shake" };
      for (const token of tokens) {
        const eq = token.indexOf("=");
        if (eq <= 0) return fail(`shake 未知参数：${token}`);
        const key = token.slice(0, eq);
        if (key !== "intensity" && key !== "duration")
          return fail(`shake 未知参数：${key}`);
        const n = Number(token.slice(eq + 1));
        if (Number.isNaN(n)) return fail(`shake.${key} 必须为数字`);
        cmd[key] = n;
      }
      return cmd;
    }
    case "text_typewriter": {
      const cmd: StoryCommand = { op: "text_typewriter" };
      for (const token of tokens) {
        const eq = token.indexOf("=");
        if (eq <= 0) return fail(`text_typewriter 未知参数：${token}`);
        const key = token.slice(0, eq);
        const raw = token.slice(eq + 1);
        if (key === "enabled") {
          if (raw !== "true" && raw !== "false")
            return fail("text_typewriter.enabled 需要 true|false");
          cmd.enabled = raw === "true";
          continue;
        }
        if (key === "speed") {
          const n = Number(raw);
          if (Number.isNaN(n) || n <= 0)
            return fail("text_typewriter.speed 必须为正数");
          cmd.speed = n;
          continue;
        }
        return fail(`text_typewriter 未知参数：${key}`);
      }
      if (cmd.enabled === undefined && cmd.speed === undefined)
        return fail("text_typewriter 至少需要 enabled 或 speed");
      return cmd;
    }
  }
  return null;
}
