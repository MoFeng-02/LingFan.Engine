/**
 * 07-文本创作模式：文本 = JSON v1 的投影（双向）。
 * - parseTextStory：文本 → Story（缩进块无 end、{…} 包表达式、// 与 # 注释、行列定位 fail-closed）
 * - generateText：Story → 文本（确定性输出：键序按字段序、缩进 2 空格、转义按老规范投影器规则）
 * - T1 往返等价 / T2 投影失败整次拒绝 / T3 JSON 树唯一真相源 / T4 与 JSON 混存（按内容识别）
 * 覆盖引擎已实现 op 全集；scene 列支持元素行（08 §二.1：`类型 "内容" key=value …`，嵌套用缩进）。
 */
import type {
  CharacterDef,
  ElementNode,
  Story,
  StoryColumn,
  StoryCommand,
} from "../contracts";
import { isElementType } from "../contracts";
import { baseName } from "./format";

export class TextFormatError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`文本投影失败（整次拒绝）：\n- ${issues.join("\n- ")}`);
    this.name = "TextFormatError";
    this.issues = issues;
  }
}

// —— 词法辅助 ——

interface SourceLine {
  indent: number;
  text: string;
  no: number; // 1 起行号（T2 定位）
}

/** 剥离行注释（// 或 #，引号内不剥；老 StripInlineComment 语义） */
function stripComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inString) {
      if (ch === "\\") {
        i += 1; // 跳过转义字符
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "/" && line[i + 1] === "/") return line.slice(0, i);
    if (ch === "#") return line.slice(0, i);
  }
  return line;
}

function tokenizeLines(
  source: string,
  sourceName: string,
  issues: string[],
): SourceLine[] {
  const out: SourceLine[] = [];
  const raw = source.split(/\r\n|\n/);
  for (let i = 0; i < raw.length; i += 1) {
    const no = i + 1;
    const stripped = stripComment(raw[i]!).replace(/\s+$/, "");
    if (stripped.trim() === "") continue;
    const match = /^([ \t]*)/.exec(stripped)!;
    const indentText = match[1]!;
    if (indentText.includes("\t")) {
      issues.push(`${sourceName}:${no}: 缩进请使用空格，不要混用 Tab`);
      continue;
    }
    out.push({ indent: indentText.length, text: stripped.trimStart(), no });
  }
  return out;
}

/** 解析引号字符串字面量（F4：\n \t \r \" \\ 已知映射，未知转义保留两字符原样） */
function unquote(token: string): string {
  if (token.length < 2 || !token.startsWith('"') || !token.endsWith('"'))
    return token;
  const inner = token.slice(1, -1);
  let out = "";
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]!;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = inner[i + 1]!;
    const map: Record<string, string> = {
      n: "\n",
      t: "\t",
      r: "\r",
      '"': '"',
      "\\": "\\",
    };
    out += map[next] ?? `\\${next}`; // F4：未知转义保留两字符
    i += 1;
  }
  return out;
}

/** 生成端转义（老规范投影器规则："→\" \→\\ 换行→\n Tab→\t，其余原样） */
function escapeForText(s: string): string {
  return s
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\t", "\\t")
    .replaceAll("\r", "\\r");
}

/** 按空格切分参数（引号字符串 / {expr} / 裸词 / key=value 保持完整） */
function splitTokens(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (inString) {
      cur += ch;
      if (ch === "\\") {
        cur += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      cur += ch;
      i += 1;
      continue;
    }
    if (ch === "{") {
      const end = text.indexOf("}", i);
      const stop = end < 0 ? text.length : end + 1;
      cur += text.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (cur !== "") out.push(cur);
      cur = "";
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  if (cur !== "") out.push(cur);
  return out;
}

/** set/define 类的值：原样透传（{expr} 复合赋值等由执行器窄化，§七） */
function parseValueLiteral(raw: string): unknown {
  const t = raw.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) return unquote(t);
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === "true") return true;
  if (t === "false") return false;
  return t; // {expr} / += 复合 / 裸词 → 原样字符串（执行器 evalValue 语义）
}

/** [a, "b", {expr}] 数组字面量 → items（每项走 parseValueLiteral 语义） */
function parseArrayLiteral(raw: string): unknown[] {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  const items: unknown[] = [];
  let cur = "";
  let inString = false;
  let depth = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]!;
    if (inString) {
      cur += ch;
      if (ch === "\\") {
        cur += inner[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      cur += ch;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      if (cur.trim() !== "") items.push(parseValueLiteral(cur));
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== "") items.push(parseValueLiteral(cur));
  return items;
}

/** 提取 `keyword {…}` 字典字面量（花括号计数支持嵌套/引号内大括号）；返回字面量与剥离后的余文 */
function extractDictLiteral(
  source: string,
  keyword: string,
): { literal: string; remainder: string } | null {
  const at = source.indexOf(`${keyword} {`);
  if (at < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = at + keyword.length; i < source.length; i += 1) {
    const ch = source[i]!;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  return {
    literal: source.slice(at + keyword.length, end + 1).trim(),
    remainder: source.slice(0, at) + source.slice(end + 1),
  };
}

/** 提取 `key={…}` 形式的字典字面量（与 `extractDictLiteral` 同法计花括号，便于 `key=值` 语法） */
function extractKeyedDictLiteral(
  source: string,
  key: string,
): { literal: string; remainder: string } | null {
  const at = source.indexOf(`${key}=`);
  if (at < 0) return null;
  const braceAt = source.indexOf("{", at + key.length + 1);
  if (braceAt < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = braceAt; i < source.length; i += 1) {
    const ch = source[i]!;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  return {
    literal: source.slice(braceAt, end + 1),
    // 保留 key= 之前的内容（目标等位置参）与闭合花括号之后的内容
    remainder: `${source.slice(0, at)} ${source.slice(end + 1)}`,
  };
}

/** {"f":v} 字典字面量 → 对象（字段值走 parseValueLiteral 语义） */
function parseDictLiteral(raw: string): Record<string, unknown> {
  const inner = raw.trim().replace(/^\{/, "").replace(/\}$/, "");
  const out: Record<string, unknown> = {};
  const parts: string[] = [];
  let cur = "";
  let inString = false;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]!;
    if (inString) {
      cur += ch;
      if (ch === "\\") {
        cur += inner[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      cur += ch;
      continue;
    }
    if (ch === ",") {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== "") parts.push(cur);
  for (const part of parts) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const key = unquote(part.slice(0, colon).trim());
    out[key] = parseValueLiteral(part.slice(colon + 1).trim());
  }
  return out;
}

// —— 语句解析 ——

interface ParseState {
  lines: SourceLine[];
  issues: string[];
  sourceName: string;
}

const SAY_FLAGS = new Set(["clickable", "okey", "noskip", "instant"]);

function parseSay(
  tokens: string[],
  at: string,
  issues: string[],
): StoryCommand {
  const cmd: StoryCommand = { op: "say", text: "" };
  let sawText = false;
  for (const token of tokens) {
    const eq = token.indexOf("=");
    const isFlag = SAY_FLAGS.has(token);
    if (!sawText && token.startsWith('"')) {
      cmd.text = unquote(token);
      sawText = true;
      continue;
    }
    if (eq > 0) {
      const key = token.slice(0, eq);
      const value = token.slice(eq + 1);
      switch (key) {
        case "speaker":
        case "by":
          cmd.speaker = unquote(value);
          continue;
        case "typewriter":
          cmd.typewriter = Number(value);
          continue;
        case "template":
          cmd.template = unquote(value);
          continue;
        case "voice":
          cmd.voice = unquote(value);
          continue;
        case "clickable":
        case "noskip":
        case "instant":
        case "okey":
          cmd[key === "okey" ? "clickable" : key] = value === "true";
          continue;
        default:
          issues.push(`${at}: say 未知参数：${key}`);
          continue;
      }
    }
    if (isFlag) {
      cmd[token === "okey" ? "clickable" : token] = true;
      continue;
    }
    issues.push(`${at}: say 无法识别的参数：${token}`);
  }
  if (!sawText) issues.push(`${at}: say 缺少 text 字符串`);
  return cmd;
}

// ====== 08 §二.1 元素行（scene 列内）：`类型 "内容" key=value …` ======

/**
 * 同时是「元素类型」与「语句 op」的名字——老引擎语句优先于元素兜底（规约 01 §二.2 亦记录
 * `popup` 元素行不可达）。这些名字在文本里一律按 op 解析；要写同名元素请用 JSON 形态。
 */
const ELEMENT_OP_CONFLICTS = new Set(["video", "background", "window"]);

/** 图像类元素的位置参归属 `source`，其余归 `text`（老引擎 DslParser.BuildEntity:290-294） */
const ELEMENT_SOURCE_TYPES = new Set(["image", "background", "portrait"]);

/** 属性值：true/false → 布尔；纯数字 → 数字；其余去引号原样（老引擎 DslParser.BoolValue 同语义） */
function parseElementAttrValue(raw: string): unknown {
  const text = raw.startsWith('"') ? unquote(raw) : raw;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

/**
 * 元素行 → `ElementNode`（08 §二.1：36 类型 + 属性全集）。
 * 位置参 `"内容"` 按类型归属（图像类 → `source`，其余 → `text`）；属性合法性由解析期 F5 兜底。
 */
function parseElementLine(
  tokens: string[],
  at: string,
  issues: string[],
): ElementNode | null {
  const type = tokens[0] ?? "";
  if (!isElementType(type)) return null;
  const node: ElementNode = { type };
  for (const token of tokens.slice(1)) {
    if (token.startsWith('"')) {
      const content = unquote(token);
      if (ELEMENT_SOURCE_TYPES.has(type)) node.source = content;
      else node.text = content;
      continue;
    }
    const eq = token.indexOf("=");
    if (eq <= 0) {
      issues.push(`${at}: 元素行无法识别的参数：${token}`);
      continue;
    }
    const key = token.slice(0, eq);
    node[key] = parseElementAttrValue(token.slice(eq + 1));
  }
  return node;
}

/** 单命令行 → StoryCommand（不支持块体的 op） */
function parseSimpleStatement(
  op: string,
  rest: string,
  tokens: string[],
  at: string,
  issues: string[],
): StoryCommand | null {
  const fail = (message: string): null => {
    issues.push(`${at}: ${message}`);
    return null;
  };
  const quoted = (index: number): string => unquote(tokens[index] ?? "");
  switch (op) {
    case "say":
      return parseSay(tokens, at, issues);
    case "set":
    case "define":
    case "let":
    case "local": {
      const keyStart = rest.indexOf('"');
      const keyEnd = keyStart < 0 ? -1 : rest.indexOf('"', keyStart + 1);
      if (tokens.length < 1 || keyStart < 0 || keyEnd < 0) {
        return fail(`${op} 文法：${op} "key" 值`);
      }
      const key = unquote(rest.slice(keyStart, keyEnd + 1));
      const value = rest.slice(keyEnd + 1).trim();
      if (key === "" || value === "") return fail(`${op} 需要 key 与 value`);
      return { op, key, value: parseValueLiteral(value) } as StoryCommand;
    }
    case "undef":
      if (tokens.length < 1) return fail("undef 需要 key");
      return { op: "undef", key: quoted(0) } as StoryCommand;
    case "jump":
      if (tokens.length < 1) return fail("jump 需要 target");
      return { op: "jump", target: tokens[0]! } as StoryCommand;
    case "navigate": {
      // 老 DSL 语法照搬：navigate "p" [scene "n"]——path 必填，scene 可选
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
    case "save": {
      // `save "s" [title "t"]`（screenshot 08-U9 延后）
      if (tokens.length < 1) return fail("save 需要 slot");
      const cmd: StoryCommand = { op: "save", slot: quoted(0) };
      if (tokens[1] === "title") {
        const title = quoted(2);
        if (title === "") return fail("save title 需要标题文本");
        cmd.title = title;
      }
      return cmd;
    }
    case "load":
      if (tokens.length < 1) return fail("load 需要 slot");
      return { op: "load", slot: quoted(0) } as StoryCommand;
    case "auto_save":
      if (tokens.length < 1)
        return fail("auto_save 需要 enabled（true/false）");
      if (tokens[0] !== "true" && tokens[0] !== "false") {
        return fail("auto_save 需要 enabled（true/false）");
      }
      return { op: "auto_save", enabled: tokens[0] === "true" } as StoryCommand;
    case "save_delete":
      if (tokens.length < 1) return fail("save_delete 需要 slot");
      return { op: "save_delete", slot: quoted(0) } as StoryCommand;
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
      }
      return cmd;
    }
    case "wait":
    case "pause": {
      const seconds = Number(tokens[0]);
      if (tokens.length < 1 || Number.isNaN(seconds))
        return fail(`${op} 需要数字 seconds`);
      const cmd: StoryCommand = { op, seconds };
      if (op === "wait" && tokens.includes("skipable")) cmd.skipable = true;
      return cmd as StoryCommand;
    }
    case "input": {
      const prompt = tokens.find((t) => t.startsWith('"'));
      const storeEq = tokens.find((t) => t.startsWith("store="));
      if (prompt === undefined || storeEq === undefined)
        return fail("input 需要 prompt 与 store");
      return {
        op: "input",
        prompt: unquote(prompt),
        store: unquote(storeEq.slice(6)),
      } as StoryCommand;
    }
    case "array_push": {
      if (tokens.length < 2) return fail("array_push 需要 key 与 value");
      return {
        op: "array_push",
        key: quoted(0),
        value: parseValueLiteral(tokens.slice(1).join(" ")),
      } as StoryCommand;
    }
    case "array_pop":
      if (tokens.length < 1) return fail("array_pop 需要 key");
      return { op: "array_pop", key: quoted(0) } as StoryCommand;
    case "array": {
      const m = /^"([^"]*)"\s+(\[.*\])(\s+once)?$/.exec(rest);
      if (m === null) return fail('array 文法：array "key" [项, …] [once]');
      const cmd: StoryCommand = {
        op: "array",
        key: unquote(`"${m[1]!}"`),
        items: parseArrayLiteral(m[2]!),
      };
      if (m[3] !== undefined) cmd.once = true;
      return cmd;
    }
    case "dict": {
      const m = /^"([^"]*)"\s+(\{.*\})(\s+once)?$/.exec(rest);
      if (m === null) return fail('dict 文法：dict "key" {…} [once]');
      const cmd: StoryCommand = {
        op: "dict",
        key: unquote(`"${m[1]!}"`),
        value: parseDictLiteral(m[2]!),
      };
      if (m[3] !== undefined) cmd.once = true;
      return cmd;
    }
    case "dict_set": {
      if (tokens.length < 3) return fail("dict_set 需要 key/field/value");
      return {
        op: "dict_set",
        key: quoted(0),
        field: quoted(1),
        value: parseValueLiteral(tokens.slice(2).join(" ")),
      } as StoryCommand;
    }
    case "random": {
      let seed: number | undefined;
      let min: number | undefined;
      let max: number | undefined;
      let key: string | undefined;
      for (const token of tokens) {
        const eq = token.indexOf("=");
        if (eq < 0) continue;
        const key2 = token.slice(0, eq);
        const value = token.slice(eq + 1);
        if (key2 === "seed") seed = Number(value);
        else if (key2 === "min") min = Number(value);
        else if (key2 === "max") max = Number(value);
        else if (key2 === "var") key = unquote(value);
      }
      if (
        seed === undefined ||
        min === undefined ||
        max === undefined ||
        key === undefined
      ) {
        return fail("random 需要 seed/min/max/var");
      }
      return {
        op: "random",
        seed,
        range: [min, max],
        var: key,
      } as StoryCommand;
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
    // 08 §六.1 音频通道：resource 位置参数 + key=value 负载（volume/loop/fade/auto_stop）
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
    case "stop_voice": {
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
    // 08 §六.5 视频族：resource 位置参数（video/cutscene）；seek_video 为秒数
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
    // ====== 08 §二.1 元素增删改 ======
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
    // ====== 08 §二.2 帧驱动表现 ======
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
    default:
      return fail(`文本投影暂不支持的语句：${op}`);
  }
}

/** 带块体的语句在 parseCommands 内联处理；此处仅单行语句分发 */
function isBlockOp(op: string): boolean {
  return ["if", "while", "for", "foreach", "switch", "menu", "func"].includes(
    op,
  );
}

/** 收集缩进 > parentIndent 的块体 */
function collectBody(
  state: ParseState,
  start: number,
  parentIndent: number,
): { commands: StoryCommand[]; end: number } {
  const { lines } = state;
  if (start >= lines.length || lines[start]!.indent <= parentIndent) {
    return { commands: [], end: start };
  }
  return parseCommands(state, start, lines[start]!.indent);
}

/**
 * 缩进体解析。`allowElements` = 允许元素行（仅 scene 列体开启；08 §二.1 元素是**声明式空间层**，
 * 与 entry 命令分组收集：元素行归 `elements`，其余语句归 `commands`——对齐老引擎 StoryLoader
 * 「非 define 非元素行 → EntryScript」的分组语义）。
 */
function parseCommands(
  state: ParseState,
  start: number,
  indent: number,
  allowElements = false,
): { commands: StoryCommand[]; elements: ElementNode[]; end: number } {
  const commands: StoryCommand[] = [];
  const elements: ElementNode[] = [];
  let i = start;
  for (;;) {
    if (i >= state.lines.length) break;
    const line = state.lines[i]!;
    if (line.indent < indent) break;
    if (line.indent > indent) {
      state.issues.push(`${state.sourceName}:${line.no}: 意外的多余缩进`);
      i += 1;
      continue;
    }
    const at = `${state.sourceName}:${line.no}`;
    const text = line.text;
    const op = /^([a-z_]+)/.exec(text)?.[1] ?? "";
    const rest = text.slice(op.length).trim();

    if (isBlockOp(op)) {
      i = parseBlockStatement(state, op, rest, line, i, commands, at);
      continue;
    }

    // 元素行（两种写法，07 §一.2）：
    //   ① 显式前缀 `element <type> …`——**与 op 同名的元素类型只能这样写**
    //      （`ELEMENT_OP_CONFLICTS`：video/background/window）；投影器对这类元素恒加前缀，
    //      故「文本 ↔ JSON」往返精确（省略前缀会让元素在回读时变成同名命令）
    //   ② 裸 `<type> …`——**语句优先**：与 op 同名的类型按 op 解析（对齐老引擎），其余按元素
    if (allowElements) {
      const explicit = op === "element";
      const bare = isElementType(op) && !ELEMENT_OP_CONFLICTS.has(op);
      if (explicit || bare) {
        const source = explicit ? rest : text;
        const type = /^([a-z_]+)/.exec(source)?.[1] ?? "";
        if (explicit && !isElementType(type)) {
          state.issues.push(
            `${at}: element 前缀后不是已知元素类型：${type === "" ? source : type}`,
          );
          i += 1;
          continue;
        }
        const node = parseElementLine(splitTokens(source), at, state.issues);
        if (node !== null) {
          // 嵌套：紧随其后更深缩进的行归 children（容器专有；子层只允许元素行）
          if (i + 1 < state.lines.length && state.lines[i + 1]!.indent > indent) {
            const childIndent = state.lines[i + 1]!.indent;
            const child = parseCommands(state, i + 1, childIndent, true);
            if (child.commands.length > 0) {
              state.issues.push(`${at}: 元素内只允许子元素行，不允许命令`);
            }
            node.children = child.elements;
            elements.push(node);
            i = child.end;
            continue;
          }
          elements.push(node);
          i += 1;
          continue;
        }
      }
    }

    const cmd = parseSimpleStatement(
      op,
      rest,
      splitTokens(rest),
      at,
      state.issues,
    );
    if (cmd !== null) commands.push(cmd);
    i += 1;
  }
  return { commands, elements, end: i };
}

/** 块体语句：if/elif/else、while、for、foreach、switch、menu、func */
function parseBlockStatement(
  state: ParseState,
  op: string,
  rest: string,
  line: SourceLine,
  start: number,
  commands: StoryCommand[],
  at: string,
): number {
  const { lines, issues, sourceName } = state;
  const bodyOf = (from: number): { commands: StoryCommand[]; end: number } =>
    collectBody(state, from, line.indent);

  const brace = rest.indexOf("{");
  const braceEnd = rest.lastIndexOf("}");
  const cond =
    brace >= 0 && braceEnd > brace
      ? rest.slice(brace, braceEnd + 1)
      : rest.trim();

  if (op === "if") {
    const cmd: StoryCommand = { op: "if", cond: cond, then: [] };
    const body = bodyOf(start + 1);
    cmd.then = body.commands;
    const elifs: Array<{ cond: string; then: StoryCommand[] }> = [];
    let elifCount = 0;
    let i = body.end;
    // else if / else 与 if 同级
    for (;;) {
      if (i >= lines.length || lines[i]!.indent !== line.indent) break;
      const t = lines[i]!.text;
      const elif = /^(?:else\s+if|elif)\s+(\{.*\})\s*$/.exec(t);
      if (elif !== null) {
        const branchBody = bodyOf(i + 1);
        elifs.push({ cond: elif[1]!, then: branchBody.commands });
        if (elifCount === 0) cmd.elif = elifs;
        elifCount += 1;
        i = branchBody.end;
        continue;
      }
      if (/^else\s*$/.test(t)) {
        const elseBody = bodyOf(i + 1);
        cmd.else = elseBody.commands;
        i = elseBody.end;
        break;
      }
      break;
    }
    commands.push(cmd);
    return i;
  }

  if (op === "while") {
    const body = bodyOf(start + 1);
    commands.push({ op: "while", cond: cond, body: body.commands });
    return body.end;
  }

  if (op === "for") {
    const m = /^"([^"]*)"\s+in\s+(\{.*\})\s*$/.exec(rest);
    if (m === null) {
      issues.push(`${at}: for 文法：for "var" in {expr}`);
      return start + 1;
    }
    const body = bodyOf(start + 1);
    commands.push({ op: "for", var: m[1]!, in: m[2]!, body: body.commands });
    return body.end;
  }

  if (op === "foreach") {
    const m = /^"([^"]*)"\s+in\s+"([^"]*)"\s*$/.exec(rest);
    if (m === null) {
      issues.push(`${at}: foreach 文法：foreach "var" in "key"`);
      return start + 1;
    }
    const body = bodyOf(start + 1);
    commands.push({
      op: "foreach",
      var: m[1]!,
      key: m[2]!,
      body: body.commands,
    });
    return body.end;
  }

  if (op === "menu") {
    const options: Array<{ text: string; target: string }> = [];
    const cmd: StoryCommand = { op: "menu", prompt: unquote(rest), options };
    let i = start + 1;
    for (;;) {
      if (i >= lines.length || lines[i]!.indent <= line.indent) break;
      const m = /^"((?:[^"\\]|\\.)*)"\s*->\s*(\S+)\s*$/.exec(lines[i]!.text);
      if (m === null) {
        issues.push(
          `${sourceName}:${lines[i]!.no}: menu 选项文法："文本" -> 目标列`,
        );
      } else {
        options.push({ text: unquote(`"${m[1]!}"`), target: m[2]! });
      }
      i += 1;
    }
    if (options.length === 0) issues.push(`${at}: menu 至少需要一个选项`);
    commands.push(cmd);
    return i;
  }

  if (op === "func") {
    const m =
      /^([A-Za-z_\u4e00-\u9fa5][\w\u4e00-\u9fa5]*)\s*\(([^)]*)\)\s*$/.exec(
        rest,
      );
    if (m === null) {
      issues.push(`${at}: func 文法：func 名称(参数, …)`);
      return start + 1;
    }
    const body = bodyOf(start + 1);
    commands.push({
      op: "func",
      name: m[1]!,
      params: m[2]!
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p !== ""),
      body: body.commands,
    });
    return body.end;
  }

  if (op === "switch") {
    const cmd: StoryCommand = { op: "switch", on: cond, cases: [] };
    let i = start + 1;
    const caseIndent = i < lines.length ? lines[i]!.indent : -1;
    for (;;) {
      if (i >= lines.length || lines[i]!.indent !== caseIndent) break;
      const t = lines[i]!.text;
      const caseMatch = /^case\s+(.+?)\s*$/.exec(t);
      if (caseMatch !== null) {
        const caseBody = collectBody(state, i + 1, caseIndent);
        (cmd.cases as Array<{ value: unknown; body: StoryCommand[] }>).push({
          value: parseValueLiteral(caseMatch[1]!),
          body: caseBody.commands,
        });
        i = caseBody.end;
        continue;
      }
      if (/^default\s*$/.test(t)) {
        const defaultBody = collectBody(state, i + 1, caseIndent);
        cmd.default = defaultBody.commands;
        i = defaultBody.end;
        continue;
      }
      break;
    }
    commands.push(cmd);
    return i;
  }

  issues.push(`${at}: 文本投影暂不支持块语句：${op}`);
  return start + 1;
}

// —— 生成器 ——

function quoteForText(s: string): string {
  return `"${escapeForText(s)}"`;
}

function generateValue(value: unknown): string {
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value === "string") {
    // {expr} 与复合赋值前缀原样透传（执行器求值语义）；其余字符串 = 字面量 → 加引号
    if (/^\{.*\}$/.test(value) || /^\s*(\+=|-=|\*=|\/=|%=)/.test(value))
      return value;
    return quoteForText(value);
  }
  return quoteForText(JSON.stringify(value));
}

function generateCommand(
  cmd: StoryCommand,
  indent: string,
  out: string[],
): void {
  const pad = indent;
  switch (cmd.op) {
    case "say": {
      let line = `${pad}say ${quoteForText(cmd.text as string)}`;
      if (cmd.speaker !== undefined && cmd.speaker !== "")
        line += ` speaker=${quoteForText(cmd.speaker as string)}`;
      if (cmd.clickable === true) line += " clickable";
      if (cmd.noskip === true) line += " noskip";
      if (cmd.instant === true) line += " instant";
      if (cmd.typewriter !== undefined) line += ` typewriter=${cmd.typewriter}`;
      if (cmd.template !== undefined)
        line += ` template=${quoteForText(cmd.template as string)}`;
      if (cmd.voice !== undefined)
        line += ` voice=${quoteForText(cmd.voice as string)}`;
      out.push(line);
      return;
    }
    case "set":
    case "define":
    case "let":
    case "local":
      out.push(
        `${pad}${cmd.op} ${quoteForText(cmd.key as string)} ${generateValue(cmd.value)}`,
      );
      return;
    case "undef":
      out.push(`${pad}undef ${quoteForText(cmd.key as string)}`);
      return;
    case "jump":
      out.push(`${pad}jump ${cmd.target}`);
      return;
    case "navigate":
      out.push(
        cmd.scene === undefined
          ? `${pad}navigate ${quoteForText(cmd.path as string)}`
          : `${pad}navigate ${quoteForText(cmd.path as string)} scene ${quoteForText(cmd.scene as string)}`,
      );
      return;
    case "save":
      out.push(
        cmd.title === undefined
          ? `${pad}save ${quoteForText(cmd.slot as string)}`
          : `${pad}save ${quoteForText(cmd.slot as string)} title ${quoteForText(cmd.title as string)}`,
      );
      return;
    case "load":
      out.push(`${pad}load ${quoteForText(cmd.slot as string)}`);
      return;
    case "auto_save":
      out.push(`${pad}auto_save ${cmd.enabled === true ? "true" : "false"}`);
      return;
    case "save_delete":
      out.push(`${pad}save_delete ${quoteForText(cmd.slot as string)}`);
      return;
    case "call":
      out.push(`${pad}call ${cmd.target}`);
      return;
    case "return":
      out.push(
        cmd.value === undefined
          ? `${pad}return`
          : `${pad}return ${generateValue(cmd.value)}`,
      );
      return;
    case "break":
      out.push(`${pad}break`);
      return;
    case "continue":
      out.push(`${pad}continue`);
      return;
    case "notify": {
      let line = `${pad}notify ${quoteForText(cmd.text as string)}`;
      if (cmd.type !== undefined)
        line += ` type=${quoteForText(cmd.type as string)}`;
      if (cmd.duration !== undefined) line += ` duration=${cmd.duration}`;
      out.push(line);
      return;
    }
    case "wait":
      out.push(
        `${pad}wait ${cmd.seconds}${cmd.skipable === true ? " skipable" : ""}`,
      );
      return;
    case "bgm":
    case "se":
    case "ambient":
    case "voice": {
      let line = `${pad}${cmd.op} ${quoteForText(cmd.resource as string)}`;
      if (cmd.volume !== undefined) line += ` volume=${cmd.volume}`;
      if (cmd.loop !== undefined) line += ` loop=${cmd.loop}`;
      if (cmd.fade !== undefined) line += ` fade=${cmd.fade}`;
      if (cmd.auto_stop !== undefined) line += ` auto_stop=${cmd.auto_stop}`;
      if (cmd.restart !== undefined) line += ` restart=${cmd.restart}`;
      out.push(line);
      return;
    }
    case "stop_bgm":
    case "stop_ambient":
    case "stop_voice": {
      let line = `${pad}${cmd.op}`;
      if (cmd.fade !== undefined) line += ` fade=${cmd.fade}`;
      out.push(line);
      return;
    }
    case "video":
    case "cutscene": {
      let line = `${pad}${cmd.op} ${quoteForText(cmd.resource as string)}`;
      if (cmd.volume !== undefined) line += ` volume=${cmd.volume}`;
      if (cmd.loop !== undefined) line += ` loop=${cmd.loop}`;
      if (cmd.skipable !== undefined) line += ` skipable=${cmd.skipable}`;
      out.push(line);
      return;
    }
    case "seek_video":
      out.push(`${pad}seek_video ${cmd.seconds}`);
      return;
    case "pause_video":
      out.push(`${pad}pause_video`);
      return;
    case "resume_video":
      out.push(`${pad}resume_video`);
      return;
    case "stop_video":
      out.push(`${pad}stop_video`);
      return;
    case "video_skipable":
      out.push(
        `${pad}video_skipable ${cmd.value === false ? "false" : "true"}`,
      );
      return;
    case "minigame": {
      // reward 键值数组以字典字面量投影（键序 = 条目序，与解析端 Object.entries 对称）
      let line = `${pad}minigame ${quoteForText(cmd.game as string)}`;
      if (cmd.on_success !== undefined)
        line += ` on_success ${quoteForText(cmd.on_success as string)}`;
      if (cmd.on_fail !== undefined)
        line += ` on_fail ${quoteForText(cmd.on_fail as string)}`;
      if (cmd.config !== undefined)
        line += ` config ${generateDictLiteral(cmd.config as Record<string, unknown>)}`;
      if (cmd.reward !== undefined) {
        const dict: Record<string, unknown> = {};
        for (const entry of cmd.reward as Array<{
          key: string;
          value: unknown;
        }>) {
          dict[entry.key] = entry.value;
        }
        line += ` reward ${generateDictLiteral(dict)}`;
      }
      out.push(line);
      return;
    }
    case "pause":
      out.push(`${pad}pause ${cmd.seconds}`);
      return;
    case "input":
      out.push(
        `${pad}input ${quoteForText(cmd.prompt as string)} store=${quoteForText(cmd.store as string)}`,
      );
      return;
    case "array":
      out.push(
        `${pad}array ${quoteForText(cmd.key as string)} [${(cmd.items as unknown[]).map(generateValue).join(", ")}]`,
      );
      return;
    case "array_push":
      out.push(
        `${pad}array_push ${quoteForText(cmd.key as string)} ${generateValue(cmd.value)}`,
      );
      return;
    case "array_pop":
      out.push(`${pad}array_pop ${quoteForText(cmd.key as string)}`);
      return;
    case "dict":
      out.push(
        `${pad}dict ${quoteForText(cmd.key as string)} ${generateDictLiteral(cmd.value as Record<string, unknown>)}`,
      );
      return;
    case "dict_set":
      out.push(
        `${pad}dict_set ${quoteForText(cmd.key as string)} ${quoteForText(cmd.field as string)} ${generateValue(cmd.value)}`,
      );
      return;
    case "random":
      out.push(
        `${pad}random seed=${cmd.seed} min=${(cmd.range as number[])[0]} max=${(cmd.range as number[])[1]} var=${quoteForText(cmd.var as string)}`,
      );
      return;
    case "nvl": {
      const mode = (cmd.mode as string | undefined) ?? "enter";
      out.push(
        mode === "enter" || mode === "auto"
          ? `${pad}nvl${mode === "auto" ? " auto" : ""}`
          : `${pad}nvl ${mode}`,
      );
      return;
    }
    case "character": {
      let line = `${pad}character ${quoteForText(cmd.key as string)}`;
      const def = cmd as unknown as CharacterDef;
      if (def.name !== undefined) line += ` name=${quoteForText(def.name)}`;
      if (def.color !== undefined) line += ` color=${quoteForText(def.color)}`;
      if (def.size !== undefined) line += ` size=${quoteForText(def.size)}`;
      if (def.textColor !== undefined)
        line += ` textColor=${quoteForText(def.textColor)}`;
      if (def.screen !== undefined)
        line += ` screen=${quoteForText(def.screen)}`;
      if (def.font !== undefined) line += ` font=${quoteForText(def.font)}`;
      out.push(line);
      return;
    }
    case "if": {
      out.push(`${pad}if ${cmd.cond}`);
      generateBody(cmd.then as StoryCommand[], indent, out);
      for (const elif of (cmd.elif ?? []) as Array<{
        cond: string;
        then: StoryCommand[];
      }>) {
        out.push(`${pad}else if ${elif.cond}`);
        generateBody(elif.then, indent, out);
      }
      if (cmd.else !== undefined && (cmd.else as StoryCommand[]).length > 0) {
        out.push(`${pad}else`);
        generateBody(cmd.else as StoryCommand[], indent, out);
      }
      return;
    }
    case "while":
      out.push(`${pad}while ${cmd.cond}`);
      generateBody(cmd.body as StoryCommand[], indent, out);
      return;
    case "for":
      out.push(`${pad}for ${quoteForText(cmd.var as string)} in ${cmd.in}`);
      generateBody(cmd.body as StoryCommand[], indent, out);
      return;
    case "foreach":
      out.push(
        `${pad}foreach ${quoteForText(cmd.var as string)} in ${quoteForText(cmd.key as string)}`,
      );
      generateBody(cmd.body as StoryCommand[], indent, out);
      return;
    case "switch":
      out.push(`${pad}switch ${cmd.on}`);
      for (const c of cmd.cases as Array<{
        value: unknown;
        body: StoryCommand[];
      }>) {
        out.push(`${pad}  case ${generateValue(c.value)}`);
        generateBody(c.body, `${indent}  `, out);
      }
      if (
        cmd.default !== undefined &&
        (cmd.default as StoryCommand[]).length > 0
      ) {
        out.push(`${pad}  default`);
        generateBody(cmd.default as StoryCommand[], `${indent}  `, out);
      }
      return;
    case "menu":
      out.push(`${pad}menu ${quoteForText(cmd.prompt as string)}`);
      for (const o of cmd.options as Array<{ text: string; target: string }>) {
        out.push(`${pad}  ${quoteForText(o.text)} -> ${o.target}`);
      }
      return;
    case "func":
      out.push(
        `${pad}func ${cmd.name}(${(cmd.params as string[]).join(", ")})`,
      );
      generateBody(cmd.body as StoryCommand[], indent, out);
      return;
    // ====== 08 §二.1 元素增删改 ======
    case "show": {
      let line = `${pad}show ${quoteForText(cmd.target as string)}`;
      if (cmd.x !== undefined) line += ` x=${elementValueText(cmd.x)}`;
      if (cmd.y !== undefined) line += ` y=${elementValueText(cmd.y)}`;
      if (cmd.id !== undefined) line += ` id=${elementValueText(cmd.id)}`;
      if (cmd.name !== undefined) line += ` name=${elementValueText(cmd.name)}`;
      if (cmd.background === true) line += " background=true";
      else if (cmd.background === false) line += " background=false";
      out.push(line);
      return;
    }
    case "hide":
      out.push(`${pad}hide ${quoteForText(cmd.target as string)}`);
      return;
    case "background":
    case "bg_switch":
      out.push(`${pad}${cmd.op} ${quoteForText(cmd.resource as string)}`);
      return;
    case "zindex":
      out.push(
        `${pad}zindex ${quoteForText(cmd.target as string)} value=${cmd.value}`,
      );
      return;
    case "style":
      out.push(
        `${pad}style ${quoteForText(cmd.target as string)} props=${generateDictLiteral(cmd.props as Record<string, unknown>)}`,
      );
      return;
    case "window":
      out.push(`${pad}window ${cmd.mode as string}`);
      return;
    // ====== 08 §二.2 帧驱动表现 ======
    case "animate": {
      let line = `${pad}animate ${quoteForText(cmd.target as string)} property=${elementValueText(cmd.property)} value=${cmd.value}`;
      if (cmd.duration !== undefined) line += ` duration=${cmd.duration}`;
      if (cmd.easing !== undefined)
        line += ` easing=${elementValueText(cmd.easing)}`;
      out.push(line);
      return;
    }
    case "animate_block": {
      let line = `${pad}animate_block ${quoteForText(cmd.target as string)}`;
      for (const key of ["x", "y", "opacity", "rotation", "scale"]) {
        if (cmd[key] !== undefined) line += ` ${key}=${cmd[key]}`;
      }
      if (cmd.duration !== undefined) line += ` duration=${cmd.duration}`;
      if (cmd.easing !== undefined)
        line += ` easing=${elementValueText(cmd.easing)}`;
      out.push(line);
      return;
    }
    case "transition": {
      let line = `${pad}transition ${quoteForText(cmd.type as string)}`;
      if (cmd.duration !== undefined) line += ` duration=${cmd.duration}`;
      out.push(line);
      return;
    }
    case "shake": {
      let line = `${pad}shake`;
      if (cmd.intensity !== undefined) line += ` intensity=${cmd.intensity}`;
      if (cmd.duration !== undefined) line += ` duration=${cmd.duration}`;
      out.push(line);
      return;
    }
    case "text_typewriter": {
      let line = `${pad}text_typewriter`;
      if (cmd.enabled !== undefined)
        line += ` enabled=${cmd.enabled ? "true" : "false"}`;
      if (cmd.speed !== undefined) line += ` speed=${cmd.speed}`;
      out.push(line);
      return;
    }
    default:
      // 未支持文本投影的 op：fail-closed（T2 不静默）
      throw new TextFormatError([`op "${cmd.op}" 暂无文本投影`]);
  }
}

function generateBody(
  commands: StoryCommand[],
  indent: string,
  out: string[],
): void {
  const inner = `${indent}  `;
  for (const cmd of commands) generateCommand(cmd, inner, out);
}

function generateDictLiteral(value: Record<string, unknown>): string {
  const fields = Object.entries(value).map(
    ([k, v]) => `${quoteForText(k)}: ${generateValue(v)}`,
  );
  return `{${fields.join(", ")}}`;
}

// —— 公共入口 ——

/** 07-T2：文本 → Story（缩进块、注释、全 op 文法；失败整次拒绝并带行列定位） */
export function parseTextStory(source: string, sourceName = "story"): Story {
  const state: ParseState = { lines: [], issues: [], sourceName };
  state.lines = tokenizeLines(source, sourceName, state.issues);
  const columns: StoryColumn[] = [];
  const defines: Record<string, unknown> = {};
  let i = 0;
  for (;;) {
    if (i >= state.lines.length) break;
    const line = state.lines[i]!;
    const at = `${sourceName}:${line.no}`;
    if (line.indent !== 0) {
      state.issues.push(`${at}: 顶层语句不应缩进`);
      i += 1;
      continue;
    }
    const label = /^label\s+(.+?)\s*:?\s*$/.exec(line.text);
    if (label !== null) {
      const name = unquote(label[1]!.replace(/:$/, "").trim());
      if (name === "" || columns.some((c) => c.id === name)) {
        state.issues.push(`${at}: label 名为空或重复：${name}`);
      }
      // 列体 = 首行缩进层级（缩进体）；下一行顶格 → 空列体
      const bodyIndent =
        i + 1 < state.lines.length && state.lines[i + 1]!.indent > 0
          ? state.lines[i + 1]!.indent
          : -1;
      const body =
        bodyIndent < 0
          ? { commands: [] as StoryCommand[], end: i + 1 }
          : parseCommands(state, i + 1, bodyIndent);
      columns.push({ id: name, kind: "flow", commands: body.commands });
      i = body.end;
      continue;
    }
    // 08 §二.1 scene 列（空间层）：`scene "列名"` + 缩进体（元素行归 elements，其余归 entry）
    const scene = /^scene\s+(.+?)\s*$/.exec(line.text);
    if (scene !== null) {
      const sceneTokens = splitTokens(line.text);
      const name = unquote(sceneTokens[1] ?? "");
      if (name === "" || columns.some((c) => c.id === name)) {
        state.issues.push(`${at}: scene 名为空或重复：${name}`);
      }
      if (sceneTokens.length > 2) {
        // 老引擎 scene 头的 type/layout 在新列模型无对应字段 → 接受但忽略（投影不生成）
        state.issues.push(
          `${at}: scene 头仅支持名称，忽略额外参数：${sceneTokens.slice(2).join(" ")}`,
        );
      }
      const bodyIndent =
        i + 1 < state.lines.length && state.lines[i + 1]!.indent > 0
          ? state.lines[i + 1]!.indent
          : -1;
      const body =
        bodyIndent < 0
          ? {
              commands: [] as StoryCommand[],
              elements: [] as ElementNode[],
              end: i + 1,
            }
          : parseCommands(state, i + 1, bodyIndent, true);
      columns.push({
        id: name,
        kind: "scene",
        elements: body.elements,
        entry: body.commands,
      });
      i = body.end;
      continue;
    }
    const topOp = /^([a-z_]+)\s+/.exec(line.text)?.[1] ?? "";
    if (topOp === "define" || topOp === "set") {
      const cmd = parseSimpleStatement(
        topOp,
        line.text,
        splitTokens(line.text),
        at,
        state.issues,
      );
      if (cmd !== null && "key" in cmd) {
        defines[cmd.key as string] = cmd.value; // 01 §一.6/F2：顶层 = 无条件 Set
      }
      i += 1;
      continue;
    }
    state.issues.push(
      `${at}: 顶层仅允许 label / define / set，收到：${line.text.slice(0, 30)}`,
    );
    i += 1;
  }
  if (state.issues.length > 0) throw new TextFormatError(state.issues);
  if (columns.length === 0) {
    throw new TextFormatError([
      `${sourceName}: 文本中没有 label（至少需要一个列）`,
    ]);
  }
  return {
    formatVersion: 1,
    id: baseName(sourceName),
    entry: columns[0]!.id,
    columns,
    defines: Object.keys(defines).length > 0 ? defines : undefined,
  };
}

/** 元素属性值 → 文本（布尔/数字裸串；含空白的字符串加引号，保证往返等价） */
function elementValueText(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  const text = String(value);
  return /\s/.test(text) ? quoteForText(text) : text;
}

/**
 * `ElementNode` → 元素行（08 §二.1）：`类型 "内容" key=value …`。
 * 确定性输出：位置参（`source` 优先，其次 `text`）紧接类型名，其余键按插入序；children 缩进 2 空格。
 *
 * **同名冲突类型加 `element ` 前缀**（`ELEMENT_OP_CONFLICTS`）：裸写会被「语句优先」回读成同名
 * op（见 `parseCommands`），加前缀后元素与 op 两侧都可达，往返精确（07 §一.2）。其余类型裸写，
 * 与既有文本/老引擎写法保持一致（不制造无谓改动）。
 */
function generateElement(node: ElementNode, pad: string, out: string[]): void {
  const tokens: string[] = ELEMENT_OP_CONFLICTS.has(node.type)
    ? ["element", node.type]
    : [node.type];
  const positional =
    typeof node.source === "string"
      ? node.source
      : typeof node.text === "string"
        ? node.text
        : undefined;
  if (positional !== undefined) tokens.push(quoteForText(positional));
  for (const [key, value] of Object.entries(node)) {
    if (key === "type" || key === "children") continue;
    if (key === "text" || key === "source") continue; // 已作位置参输出
    tokens.push(`${key}=${elementValueText(value)}`);
  }
  out.push(`${pad}${tokens.join(" ")}`);
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      generateElement(child as ElementNode, `${pad}  `, out);
    }
  }
}

/** 06 编辑器文本模式契约：容错投影——不可投影部分（未知 op）收集为 issues，其余照常输出 */
export interface TextProjection {
  text: string;
  issues: string[];
}

export function projectText(story: Story): TextProjection {
  const issues: string[] = [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(story.defines ?? {})) {
    out.push(`define ${quoteForText(key)} ${generateValue(value)}`);
  }
  for (const column of story.columns) {
    if (column.kind === "scene") {
      // 08 §二.1 scene 列：元素行在前、entry 命令在后（与装载语义一致——先声明空间层再执行）
      out.push(`scene ${column.id}`);
      for (const node of column.elements ?? []) {
        generateElement(node, "  ", out);
      }
      for (const cmd of column.entry ?? []) {
        try {
          generateCommand(cmd, "  ", out);
        } catch (e) {
          if (e instanceof TextFormatError) issues.push(...e.issues);
          else throw e;
        }
      }
      continue;
    }
    out.push(`label ${column.id}:`);
    for (const cmd of column.commands ?? []) {
      try {
        generateCommand(cmd, "  ", out); // 列体 2 空格缩进（规范形）
      } catch (e) {
        if (e instanceof TextFormatError) issues.push(...e.issues);
        else throw e;
      }
    }
  }
  return { text: `${out.join("\n")}\n`, issues };
}

/** 07-T1/T3：Story → 文本（确定性输出）。不可投影部分收集为 issues 后整次拒绝（fail-closed） */
export function generateText(story: Story): string {
  const { text, issues } = projectText(story);
  if (issues.length > 0) throw new TextFormatError(issues);
  return text;
}
