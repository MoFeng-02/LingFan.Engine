/**
 * 编辑期 fail-closed 校验执行：把 zod issue 翻译为中文人话诊断（未知 op /
 * 未知字段 / 缺必填 / 类型错），供 `validateStory` 与属性面板实时校验共用。
 */
import { z } from "zod";
import type { Diagnostic } from "../../contracts";
import { escapePointerToken } from "../../contracts";
import { OP_SCHEMAS } from "./map";

/**
 * **「resource 为空」时该用哪个停止命令**。
 *
 * 为什么需要：既有工程里有 `bgm ""` 表「停止 BGM」的写法，而播放器对空路径
 * **无特判**（直接以空串去加载）⇒ **静默失败**——作者以为停了，其实没有。
 * 显式报错比「静默通过」更正确，但直接抛 zod 英文原话
 * （`Too small: expected string to have >=1 characters`）作者既看不懂、
 * 也不知道该改什么。
 *
 * 处置 = **保持严格校验**（不引入「空路径=停止」这种隐式约定）
 * + **把正确写法直接告诉作者**（语义明确）。
 */
const STOP_OP_BY_RESOURCE_OWNER: Readonly<Record<string, string>> = {
  bgm: "stop_bgm",
  ambient: "stop_ambient",
  voice: "stop_voice",
  video: "stop_video",
  cutscene: "stop_video",
};

/**
 * zod 错误 → **中文人话**（编辑期诊断给作者看，不该直接透传英文）。
 *
 * **兜底保留原文**：没覆盖的 code 返回 `issue.message`——
 * 宁可英文也不静默丢信息（不吞信息）。
 */
function localizeZodIssue(op: string, issue: z.core.$ZodIssue): string {
  const field = issue.path.map(String).join(".");
  const at = field === "" ? "" : `${field} `;
  switch (issue.code) {
    case "too_small": {
      const min = (issue as { minimum?: number }).minimum;
      if (field === "resource" || field.endsWith(".resource")) {
        const stopOp = STOP_OP_BY_RESOURCE_OWNER[op];
        return stopOp === undefined
          ? "资源路径不能为空"
          : `资源路径不能为空（要**停止**该通道请用 \`${stopOp}\`）`;
      }
      return typeof min === "number" && min > 0
        ? `${at}不能小于 ${min}`
        : `${at}值太小`;
    }
    case "too_big": {
      const max = (issue as { maximum?: number }).maximum;
      return typeof max === "number" ? `${at}不能大于 ${max}` : `${at}值太大`;
    }
    case "invalid_type": {
      const expected = (issue as { expected?: unknown }).expected;
      return `${at}类型不对${typeof expected === "string" ? `（需要 ${expected}）` : ""}`;
    }
    case "invalid_format": {
      const format = (issue as { format?: unknown }).format;
      return `${at}格式不对${typeof format === "string" ? `（要求 ${format}）` : ""}`;
    }
    default:
      return issue.message;
  }
}

function issueToDiagnostic(
  issue: z.core.$ZodIssue,
  basePointer: string,
  op: string,
): Diagnostic {
  const segments = issue.path.map((seg) => escapePointerToken(String(seg)));
  const pointer =
    segments.length > 0 ? `${basePointer}/${segments.join("/")}` : basePointer;
  if (issue.code === "unrecognized_keys") {
    const keys =
      "keys" in issue && Array.isArray(issue.keys)
        ? issue.keys.map(String).join(", ")
        : issue.message;
    return {
      code: "unknown-field",
      severity: "error",
      message: `${op} 未知负载字段：${keys}（编辑期 fail-closed）`,
      pointer,
      op,
    };
  }
  const received = (issue as { received?: unknown }).received;
  if (
    issue.code === "invalid_type" &&
    (received === undefined || received === "undefined")
  ) {
    return {
      code: "missing-required",
      severity: "error",
      message: `${op}${issue.path.length > 0 ? `.${issue.path.join(".")}` : ""} 必填`,
      pointer,
      op,
    };
  }
  return {
    code: "invalid-value",
    severity: "error",
    message: `${op}${issue.path.length > 0 ? `.${issue.path.join(".")}` : ""}：${localizeZodIssue(op, issue)}`,
    pointer,
    op,
  };
}

/**
 * 编辑期单命令 fail-closed 校验（结构层）：未知 op / 未知字段 / 缺必填 / 类型错。
 * pointer = 命令对象自身在 Story 树上的 JSON Pointer。
 * `schemas`（可选）= op 负载 schema 面（缺省内建 OP_SCHEMAS；扩展注册后传合并集）。
 * 编辑期 fail-closed 校验的测试见 validation.test。
 */
export function validateCommand(
  cmd: unknown,
  pointer = "",
  schemas: Readonly<Record<string, z.ZodType>> = OP_SCHEMAS,
): Diagnostic[] {
  if (typeof cmd !== "object" || cmd === null || Array.isArray(cmd)) {
    return [
      {
        code: "invalid-structure",
        severity: "error",
        message: "命令必须为对象",
        pointer,
      },
    ];
  }
  const op = (cmd as Record<string, unknown>).op;
  if (typeof op !== "string" || op === "") {
    return [
      {
        code: "invalid-structure",
        severity: "error",
        message: "命令必须为含非空 op 字符串的命令对象",
        pointer,
      },
    ];
  }
  const schema = schemas[op];
  if (schema === undefined) {
    return [
      {
        code: "unknown-op",
        severity: "error",
        message: `未知或未实现的命令：${op}`,
        pointer,
        op,
      },
    ];
  }
  const payload: Record<string, unknown> = {
    ...(cmd as Record<string, unknown>),
  };
  delete payload.op;
  const result = schema.safeParse(payload);
  if (result.success) return [];
  return result.error.issues.map((issue) =>
    issueToDiagnostic(issue, pointer, op),
  );
}
