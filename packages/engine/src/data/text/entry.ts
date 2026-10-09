/**
 * 文本创作模式的公共入口：文本 → Story、Story → 文本，以及容错投影。
 * 三个入口的失败口径统一为 `TextFormatError`（整次拒绝，带行列定位）。
 */
import { baseName } from "../format";
import { parseCommands, parseSimpleStatement, type ParseState } from "./parse";
import { generateCommand } from "./generate/command";
import { generateElement } from "./generate/element";
import { tokenizeLines, splitTokens, unquote } from "./lexer";
import { quoteForText, generateValue } from "./literals";
import { TextFormatError } from "./error";
import { recordTextProjectionWarnings } from "./warnings";
import type { Story, StoryColumn, StoryCommand, ElementNode, CustomOpProjections, TextProjection } from "../../contracts";

/** 文本 → Story（缩进块、注释、全 op 文法；失败整次拒绝并带行列定位）。
 * `projections`（可选）= 扩展自定义 op 的行投影表；缺省 = 现行为逐字节不变。 */
export function parseTextStory(
  source: string,
  sourceName = "story",
  projections?: CustomOpProjections,
): Story {
  const state: ParseState = { lines: [], issues: [], warnings: [], sourceName, projections };
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
    // scene 列（空间层）：`scene "列名"` + 缩进体（元素行归 elements，其余归 entry）
    const scene = /^scene\s+(.+?)\s*$/.exec(line.text);
    if (scene !== null) {
      const sceneTokens = splitTokens(line.text);
      const name = unquote(sceneTokens[1] ?? "");
      if (name === "" || columns.some((c) => c.id === name)) {
        state.issues.push(`${at}: scene 名为空或重复：${name}`);
      }
      // `type=menu|ui|game`：**映射到列的运行语义**。
      // 若「接受但忽略」，作者的 menu 场景**会被当成 game**
      // ⇒ 保存后菜单会变成可回溯剧情（且不可逆）。
      let sceneType: "game" | "menu" | "ui" | undefined;
      const rest: string[] = [];
      for (let t = 2; t < sceneTokens.length; t += 1) {
        const token = sceneTokens[t]!;
        const eq = token.indexOf("=");
        const key = eq > 0 ? token.slice(0, eq) : "";
        const value = eq > 0 ? unquote(token.slice(eq + 1)) : "";
        if (key === "type" && (value === "game" || value === "menu" || value === "ui")) {
          sceneType = value;
          continue;
        }
        rest.push(token);
      }
      if (rest.length > 0) {
        // 其余旧式头参数（layout 等）在新列模型无对应字段 → 接受但忽略（投影不生成）
        state.issues.push(
          `${at}: scene 头忽略无法识别的参数：${rest.join(" ")}`,
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
        // 仅在**非缺省**时写（`game` 是常态，写进去会让文件噪声变大）
        ...(sceneType !== undefined && sceneType !== "game" ? { type: sceneType } : {}),
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
        defines[cmd.key as string] = cmd.value; // 顶层 = 无条件 Set
      }
      i += 1;
      continue;
    }
    state.issues.push(
      `${at}: 顶层仅允许 label / define / set，收到：${line.text.slice(0, 30)}`,
    );
    i += 1;
  }
  if (state.issues.length > 0) {
    recordTextProjectionWarnings(state.warnings);
    throw new TextFormatError(state.issues);
  }
  if (columns.length === 0) {
    recordTextProjectionWarnings(state.warnings);
    throw new TextFormatError([
      `${sourceName}: 文本中没有 label（至少需要一个列）`,
    ]);
  }
  recordTextProjectionWarnings(state.warnings);
  return {
    formatVersion: 1,
    id: baseName(sourceName),
    entry: columns[0]!.id,
    columns,
    defines: Object.keys(defines).length > 0 ? defines : undefined,
  };
}

/**
 * 文本投影的结果形状定义在契约层（`contracts/text.ts`），此处按原路径转出，
 * 既有消费方无需改动即可继续从本模块取；收口时统一改走包出口。
 */
export type { TextProjection } from "../../contracts";

export function projectText(
  story: Story,
  projections?: CustomOpProjections,
): TextProjection {
  const issues: string[] = [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(story.defines ?? {})) {
    out.push(`define ${quoteForText(key)} ${generateValue(value)}`);
  }
  for (const column of story.columns) {
    if (column.kind === "scene") {
      // scene 列：元素行在前、entry 命令在后（与装载语义一致——先声明空间层再执行）
      out.push(`scene ${column.id}`);
      for (const node of column.elements ?? []) {
        tolerant(`元素 ${String(node.type ?? "")}`, issues, () =>
          generateElement(node, "  ", out),
        );
      }
      for (const cmd of column.entry ?? []) {
        tolerant(`op "${cmd.op}"（${column.id}）`, issues, () =>
          generateCommand(cmd, "  ", out, projections),
        );
      }
      continue;
    }
    out.push(`label ${column.id}:`);
    for (const cmd of column.commands ?? []) {
      tolerant(`op "${cmd.op}"（${column.id}）`, issues, () =>
        generateCommand(cmd, "  ", out, projections), // 列体 2 空格缩进（规范形）
      );
    }
  }
  return { text: `${out.join("\n")}\n`, issues };
}

/**
 * 单命令/单元素**容错投影**：一条不可投影只产一条 issue，其余照常输出。
 * `TextFormatError` = 已知的不可投影性（原文上报）；其余异常附上 op 定位后同样降级
 * （半成品命令不得拖垮整棵树；严格路径 `generateText` 仍以 issues 非空整次拒绝，fail-closed 不放松）。
 */
function tolerant(
  label: string,
  issues: string[],
  run: () => void,
): void {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof TextFormatError) issues.push(...error.issues);
    else issues.push(`${label} 文本投影失败：${String(error)}`);
  }
}

/** Story → 文本（确定性输出）。不可投影部分收集为 issues 后整次拒绝（fail-closed）。
 * `projections`（可选）= 扩展自定义 op 的行投影表；缺省 = 现行为逐字节不变。 */
export function generateText(
  story: Story,
  projections?: CustomOpProjections,
): string {
  const { text, issues } = projectText(story, projections);
  if (issues.length > 0) throw new TextFormatError(issues);
  return text;
}
