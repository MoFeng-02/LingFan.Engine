/** flow 族的读向解析。 */
import { parseValueLiteral, parseDictLiteral, extractDictLiteral } from "../../literals";
import { unquote } from "../../lexer";
import { StoryCommand } from "../../../../contracts";
import { StatementContext } from "../state";

/**
 * 解析本族的 op 行（`jump` `navigate` `call` `return` `break` `continue` `minigame` `character` `scene`）。
 *
 * 入参是分发骨架建好的 `StatementContext`（已切好的词表、定位前缀、issue 出口与警告通道）。
 * 只处理本族的 op，不匹配时落到末尾 `return null`，由骨架决定后续。
 * 失败表现：不抛异常；语法或参数不符时用 `c.fail` 记一条带定位的 issue 并返回 `null`，
 * 由调用方按 issues 非空整次拒绝。语义暂未生效的情况记到警告通道，不阻塞解析。
 */
export function parseFlowStatement(c: StatementContext): StoryCommand | null {
  const { op, rest, tokens, fail, quoted } = c;
  switch (op) {
    case "jump":
      if (tokens.length < 1) return fail("jump 需要 target");
      return { op: "jump", target: tokens[0]! } as StoryCommand;
    case "navigate": {
      // 导航语法：navigate "p" [scene "n"]——path 必填，scene 可选
      if (tokens.length < 1) return fail("navigate 需要 path");
      const path = quoted(0);
      if (path === "") return fail("navigate 需要 path");
      const cmd: StoryCommand = { op: "navigate", path };
      if (tokens[1] === "scene") {
        const scene = quoted(2);
        if (scene === "") return fail("navigate scene 需要名称");
        cmd.scene = scene;
      }
      return cmd;
    }
    case "call":
      if (tokens.length < 1) return fail("call 需要 target");
      return { op: "call", target: tokens[0]! } as StoryCommand;
    case "return": {
      const value = rest.slice(op.length).trim();
      return value === ""
        ? { op: "return" }
        : ({ op: "return", value: parseValueLiteral(value) } as StoryCommand);
    }
    case "break":
      return { op: "break" } as StoryCommand;
    case "continue":
      return { op: "continue" } as StoryCommand;
    case "minigame": {
      // `minigame "game" [on_success "col"] [on_fail "col"] [config {…}] [reward {…}]`
      // reward 键值数组以字典字面量投影（键序即条目序）；config 值为标量/{expr} 字面量
      const gameMatch = /^"([^"]*)"/.exec(rest);
      const game = gameMatch === null ? "" : gameMatch[1]!;
      if (game === "") {
        return fail(
          'minigame 文法：minigame "game" [on_success "col"] [on_fail "col"] [config {…}] [reward {…}]',
        );
      }
      const cmd: StoryCommand = { op: "minigame", game };
      let remainder = rest.slice(gameMatch![0]!.length);
      const configDict = extractDictLiteral(remainder, "config");
      if (configDict !== null) {
        remainder = configDict.remainder;
        cmd.config = parseDictLiteral(configDict.literal);
      }
      const rewardDict = extractDictLiteral(remainder, "reward");
      if (rewardDict !== null) {
        remainder = rewardDict.remainder;
        cmd.reward = Object.entries(parseDictLiteral(rewardDict.literal)).map(
          ([key, value]) => ({ key, value }),
        );
      }
      for (const field of ["on_success", "on_fail"] as const) {
        const m = new RegExp(`\\b${field}\\s+"([^"]*)"`).exec(remainder);
        if (m === null) continue;
        if (m[1] === "") return fail(`minigame ${field} 需要非空目标列`);
        cmd[field] = m[1];
      }
      const zMatch = /(?:^|\s)(?:z|z-index)=(-?[\d.]+)/.exec(remainder); // 实例级 z
      if (zMatch !== null) cmd.z = Number(zMatch[1]);
      return cmd;
    }
    case "character": {
      const key = tokens.find((t) => t.startsWith('"'));
      if (key === undefined) return fail("character 需要 key");
      const cmd: StoryCommand = { op: "character", key: unquote(key) };
      for (const token of tokens) {
        const eq = token.indexOf("=");
        if (eq < 0) continue;
        const field = token.slice(0, eq);
        const value = unquote(token.slice(eq + 1));
        if (
          ["name", "color", "size", "font", "textColor", "screen"].includes(
            field,
          )
        ) {
          cmd[field] = value;
        }
      }
      return cmd;
    }
    case "scene": {
      // **列内 `scene "目标"` = 跳转**。
      // 工程里常见在**文件中间**用 `scene "title_main"` 跳回标题场景
      // ——若一律落到「暂不支持的语句」，整个工程就打不开。
      //
      // 语义对齐：`scene "x"`（跳转）≡ `navigate "x"`（坐标切换命令）。
      // 区别于**列声明**的 `scene "名" type=menu`（那个在顶层解析，见 `parseTextStory`）。
      // `tokens[0]` 是 op 本身，目标名在 `tokens[1]`（`splitTokens` 的口径）
      const target = quoted(0);
      if (target === "") return fail("scene 需要目标场景名");
      return { op: "navigate", path: target } satisfies StoryCommand;
    }
  }
  return null;
}
