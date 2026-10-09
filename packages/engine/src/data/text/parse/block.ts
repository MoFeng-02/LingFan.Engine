/**
 * 带块体的语句：缩进体收集与块体分发。
 * `collectBody` 只按缩进切范围，具体语法由各族分支决定。
 */
import { unquote, splitTokens, type SourceLine } from "../lexer";
import { parseValueLiteral } from "../literals";
import { ELEMENT_OP_CONFLICTS, parseElementLine } from "./element";
import { parseSimpleStatement } from "./statement";
import { isElementType, type ElementNode, type StoryCommand } from "../../../contracts";
import type { ParseState } from "./state";

/** 带块体的语句在 parseCommands 内联处理；此处仅单行语句分发 */
export function isBlockOp(op: string): boolean {
  return ["if", "while", "for", "foreach", "switch", "menu", "func"].includes(
    op,
  );
}

/** 收集缩进 > parentIndent 的块体 */
export function collectBody(
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
 * 缩进体解析。`allowElements` = 允许元素行（仅 scene 列体开启；元素是声明式空间层，
 * 与 entry 命令分组收集：元素行归 `elements`，其余语句归 `commands`——
 * 「非 define 非元素行 → EntryScript」的分组语义）。
 */
export function parseCommands(
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

    // 元素行（两种写法）：
    //   ① 显式前缀 `element <type> …`——**与 op 同名的元素类型只能这样写**
    //      （`ELEMENT_OP_CONFLICTS`：video/background/window）；投影器对这类元素恒加前缀，
    //      故「文本 ↔ JSON」往返精确（省略前缀会让元素在回读时变成同名命令）
    //   ② 裸 `<type> …`——**语句优先**：与 op 同名的类型按 op 解析，其余按元素
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

    // 扩展投影：声明了 fromText 的自定义 op 行交给投影器；
    // 失败 = 该行 issue（parseTextStory 仍整次拒绝，口径不变），不再落内建「暂不支持」分支混淆定位。
    const fromText = state.projections?.get(op)?.fromText;
    if (fromText !== undefined) {
      const cmd = customFromText(fromText, text, at, state.issues);
      if (cmd !== null) commands.push(cmd);
      i += 1;
      continue;
    }

    const cmd = parseSimpleStatement(
      op,
      rest,
      splitTokens(rest),
      at,
      state.issues,
      state.warnings,
    );
    if (cmd !== null) commands.push(cmd);
    i += 1;
  }
  return { commands, elements, end: i };
}

/**
 * 自定义 op 行投影兜底（不抛约束的引擎半边）：投影器抛出/返回畸形 = 该行 issue
 * （带 `sourceName:行号` 定位）；返回的命令须为含字符串 op 的对象（引擎只做形状守卫）。
 */
export function customFromText(
  fromText: (text: string) => StoryCommand | null,
  text: string,
  at: string,
  issues: string[],
): StoryCommand | null {
  try {
    const raw = fromText(text);
    if (
      raw !== null &&
      typeof raw === "object" &&
      typeof raw.op === "string"
    ) {
      return raw;
    }
  } catch (error: unknown) {
    issues.push(
      `${at}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
  issues.push(`${at}: 自定义 op 行解析失败：${text}`);
  return null;
}

/** 块体语句：if/elif/else、while、for、foreach、switch、menu、func */
export function parseBlockStatement(
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
    // 实例级 z：`menu "提示" z=20` —— 先从行尾摘掉，避免混进 prompt
    let menuRest = rest;
    let menuZ: number | undefined;
    const menuZMatch = /(?:^|\s)(?:z|z-index)=(-?[\d.]+)\s*$/.exec(menuRest);
    if (menuZMatch !== null) {
      menuZ = Number(menuZMatch[1]);
      menuRest = menuRest.slice(0, menuZMatch.index).trim();
    }
    const cmd: StoryCommand = { op: "menu", prompt: unquote(menuRest), options };
    if (menuZ !== undefined) cmd.z = menuZ;
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
