/** dialog 族的读向解析。 */
import { parseSay } from "../say";
import { unquote } from "../../lexer";
import { StoryCommand } from "../../../../contracts";
import { StatementContext } from "../state";

/**
 * 解析本族的 op 行（`say` `assert` `guard` `notify` `wait` `pause` `input` `nvl`）。
 *
 * 入参是分发骨架建好的 `StatementContext`（已切好的词表、定位前缀、issue 出口与警告通道）。
 * 只处理本族的 op，不匹配时落到末尾 `return null`，由骨架决定后续。
 * 失败表现：不抛异常；语法或参数不符时用 `c.fail` 记一条带定位的 issue 并返回 `null`，
 * 由调用方按 issues 非空整次拒绝。语义暂未生效的情况记到警告通道，不阻塞解析。
 */
export function parseDialogStatement(c: StatementContext): StoryCommand | null {
  const { op, rest, tokens, at, issues, warnings, fail } = c;
  switch (op) {
    case "say":
      return parseSay(tokens, at, issues);
    case "assert": {
      // 文法：assert {expr} ["可选消息"] —— cond 取花括号跨度（与 if/while 同口径，
      // rest 保原样所以花括号内空格安全）；消息取行尾带引号串。无 body（单点校验）。
      const m = /^(\{.*\})\s*(?:"([^"]*)")?\s*$/.exec(rest);
      if (m === null) return fail("assert 文法：assert {expr} [\"消息\"]");
      const cmd: StoryCommand = { op: "assert", cond: m[1]! };
      if (m[2] !== undefined) cmd.message = m[2]!;
      return cmd;
    }
    case "guard": {
      // 文法：guard "守卫名" {JSON 参数对象?} —— 参数是**纯 JSON 数据**（非表达式），
      // 与 generate 端 JSON.stringify 严格互逆；解析失败 fail-closed（不静默丢参数）。
      const m = /^"([^"]*)"\s*(\{.*\})?\s*$/.exec(rest);
      if (m === null) return fail("guard 文法：guard \"守卫名\" {参数对象?}");
      const cmd: StoryCommand = { op: "guard", fn: m[1]! };
      if (m[2] !== undefined) {
        let args: unknown;
        try {
          args = JSON.parse(m[2]!);
        } catch {
          return fail(`guard 参数不是合法 JSON：${m[2]!}`);
        }
        if (typeof args !== "object" || args === null || Array.isArray(args))
          return fail("guard 参数必须为 JSON 对象字面量");
        cmd.args = args as Record<string, unknown>;
      }
      return cmd;
    }
    case "notify": {
      const text = tokens.find((t) => t.startsWith('"'));
      if (text === undefined) return fail("notify 需要 text");
      const cmd: StoryCommand = { op: "notify", text: unquote(text) };
      for (const token of tokens) {
        const eq = token.indexOf("=");
        if (eq < 0) continue;
        const key = token.slice(0, eq);
        const value = token.slice(eq + 1);
        if (key === "type") cmd.type = unquote(value);
        else if (key === "duration") cmd.duration = Number(value);
        else if (key === "z" || key === "z-index") cmd.z = Number(value); // 实例级 z
      }
      return cmd;
    }
    case "wait":
    case "pause": {
      const seconds = Number(tokens[0]);
      if (tokens.length < 1 || Number.isNaN(seconds)) {
        // **无参 `pause` 按 0 秒处理并警告**。
        // 传统写法里无参 `pause` 表「等玩家点击」，本实现只支持定时停顿。
        // 判据：**不静默丢**（原文照进 Story，命令序列完整），
        // **也不 fail-closed**（那会让整个工程打不开——惩罚大于收益）。
        // 时长取 0（= 立即继续），警告告诉作者「这行没有停顿效果，要等点击请用 wait」。
        (warnings ?? issues).push(
          `${at}: ${op} 无参数——按 0 秒处理（立即继续）；` +
            `如需等玩家点击请改用 \`wait\`（可 skipable）或补秒数如 \`${op} 1.5\``,
        );
        return { op, seconds: 0 } as StoryCommand;
      }
      const cmd: StoryCommand = { op, seconds };
      if (op === "wait" && tokens.includes("skipable")) cmd.skipable = true;
      return cmd as StoryCommand;
    }
    case "input": {
      const prompt = tokens.find((t) => t.startsWith('"'));
      const storeEq = tokens.find((t) => t.startsWith("store="));
      if (prompt === undefined || storeEq === undefined)
        return fail("input 需要 prompt 与 store");
      const cmd: StoryCommand = {
        op: "input",
        prompt: unquote(prompt),
        store: unquote(storeEq.slice(6)),
      };
      const zEq = tokens.find(
        (t) => t.startsWith("z=") || t.startsWith("z-index="),
      );
      if (zEq !== undefined) {
        cmd.z = Number(zEq.slice(zEq.indexOf("=") + 1)); // 实例级 z
      }
      return cmd as StoryCommand;
    }
    case "nvl": {
      // nvl [clear|exit|auto]——缺省 = 进入累积层
      const sub = tokens[0];
      if (sub === undefined) return { op: "nvl" } as StoryCommand;
      if (!["clear", "exit", "auto", "enter"].includes(sub)) {
        return fail(`nvl 未知子命令：${sub}`);
      }
      return {
        op: "nvl",
        mode: sub === "enter" ? "auto" : sub,
      } as StoryCommand;
    }
  }
  return null;
}
