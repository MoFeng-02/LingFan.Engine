/**
 * 06-D3 编辑期故事级校验：envelope（故事/列结构）+ 共享遍历器的逐命令校验
 * （嵌套块体里的未知 op/坏负载同样拿到精确 JSON Pointer 诊断）。
 * 结构校验面与 packages/engine format.ts 对齐（单列文件名不变量归组装器，此处不管）。
 * 锚点: edit-time-validation
 */

import { z } from "zod";
import type { Diagnostic } from "../contracts";
import { escapePointerToken } from "../contracts";
import type { OpExtension } from "@lingfan/engine";
import { validateElementNode } from "@lingfan/engine";
import { validateCommand } from "./opSchemas";
import { mergeOpSurface } from "./surface";
import { walkStoryCommands, walkStoryElements } from "./walk";

const NonEmpty = z.string().min(1);

export const columnSchema = z.object({
  id: NonEmpty,
  kind: z.enum(["scene", "flow"]),
  elements: z.array(z.unknown()).optional(),
  entry: z.array(z.unknown()).optional(),
  commands: z.array(z.unknown()).optional(),
});

export const storySchema = z.object({
  formatVersion: z.literal(1),
  id: NonEmpty,
  entry: NonEmpty,
  columns: z.array(columnSchema).min(1),
  defines: z.record(z.string(), z.unknown()).optional(),
  lang: z.string().optional(),
});

function issuesToDiagnostics(
  issues: z.core.$ZodIssue[],
  basePointer: string,
): Diagnostic[] {
  return issues.map((issue) => {
    const segments = issue.path.map((seg) => escapePointerToken(String(seg)));
    const pointer =
      segments.length > 0
        ? `${basePointer}/${segments.join("/")}`
        : basePointer;
    return {
      code: "invalid-structure",
      severity: "error",
      message: issue.message,
      pointer,
    };
  });
}

/**
 * 06-D3 编辑期整树 fail-closed 校验：envelope 结构 + 全部列（flow/scene 两容器）
 * 及嵌套块体的逐命令校验。诊断一律带 JSON Pointer（D6）。
 * `extensions`（T08-04，可选）：扩展 op 经合并面纳入校验（缺省 = 内建面，未注册 op 仍 unknown-op）。
 */
export function validateStory(
  story: unknown,
  extensions: readonly OpExtension[] = [],
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const result = storySchema.safeParse(story);
  if (!result.success) {
    out.push(...issuesToDiagnostics(result.error.issues, ""));
  }
  const surface = mergeOpSurface(extensions);
  walkStoryCommands(
    story,
    (cmd, pointer) => {
      out.push(...validateCommand(cmd, pointer, surface.schemas));
    },
    surface,
  );
  // 08 §二.1 scene 列元素：复用引擎 F5 单一事实源（编辑期与运行期同口径）。
  // 逐节点遍历 + `validateElementNode`（**单节点**版）——不能用带递归的 `validateElement`，
  // 否则与遍历叠加会双报同一子元素问题。
  walkStoryElements(story, (node, pointer) => {
    const issues: string[] = [];
    validateElementNode(node, pointer, issues);
    for (const message of issues) {
      out.push({
        code: "invalid-element",
        severity: "error",
        message,
        pointer,
      });
    }
  });
  return out;
}
