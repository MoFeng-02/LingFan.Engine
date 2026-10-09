/**
 * 文本词法层：行注释剥离、按缩进切行、引号字面量与参数切分。
 * 只管「一行文本怎么切成 token」，语句语义判定在 parse/ 下。
 */
export interface SourceLine {
  indent: number;
  text: string;
  no: number; // 1 起行号（错误定位）
}

/** 剥离行注释（// 或 #，引号内不剥；老 StripInlineComment 语义） */
export function stripComment(line: string): string {
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

/**
 * 把源文本切成带缩进与行号的逻辑行表，供后续读取。
 *
 * 输入：故事文本全文 + 源名（仅用于报错定位）+ 外部 issues 数组。
 * 产出：非空逻辑行 `{ indent, text, no }`，`indent` = 行首空格数（缩进是块归属的唯一依据），
 * `no` = 原文行号（1 起），`text` 已剥除行内注释（`//` 与 `#`，引号内的不算）并去掉行尾空白。
 * 空行与纯注释行不产出条目——行号仍按原文计数，故 `no` 不连续是预期的。
 * 失败表现：不抛异常。缩进中出现 Tab 时向 `issues` 推一条带 `源名:行号` 的定位信息并跳过该行
 * （跳过而非中断：一次报全所有缩进问题，调用方按 `issues` 非空整次拒绝）。
 */
export function tokenizeLines(
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

/** 解析引号字符串字面量（\n \t \r \" \\ 已知映射，未知转义保留两字符原样） */
export function unquote(token: string): string {
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
    out += map[next] ?? `\\${next}`; // 未知转义保留两字符
    i += 1;
  }
  return out;
}

/** 生成端转义（"→\" \→\\ 换行→\n Tab→\t，其余原样） */
export function escapeForText(s: string): string {
  return s
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\t", "\\t")
    .replaceAll("\r", "\\r");
}

/** 按空格切分参数（引号字符串 / {expr} / 裸词 / key=value 保持完整） */
export function splitTokens(text: string): string[] {
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
