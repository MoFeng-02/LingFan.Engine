/**
 * 分析入口：先取符号索引（./symbols），再叠加结构校验与逐条语义诊断。
 * 行为契约（诊断族与缺省跳过口径）见 analyzeStory 的函数注释。
 */
import type { Story } from "@lingfan/engine";
import { ELEMENT_OPS_BLOCKED } from "@lingfan/engine";
import type { AnalyzeOptions, Diagnostic } from "../contracts";
import { escapePointerToken } from "../contracts";
import { UNIMPLEMENTED_ELEMENT_ATTRS } from "../schema";
import { walkStoryElements } from "../schema";
import { validateStory } from "../schema";
import { isPlainObject } from "../shared";
import { indexStory } from "./symbols";

/**
 * 编辑期诊断集（结构校验 + 语义诊断，一律带 JSON Pointer）。
 * resourceFiles / overlayKeys 缺省时对应诊断族跳过（供给侧数据未接入不误报）。
 */
export function analyzeStory(
  story: Story,
  options: AnalyzeOptions = {},
): Diagnostic[] {
  const out: Diagnostic[] = validateStory(story);
  const index = indexStory(story);

  for (const duplicate of index.duplicateColumns) {
    out.push({
      code: "duplicate-column",
      severity: "error",
      message: `columnId 重复：${duplicate.id}（columnId 全局唯一）`,
      pointer: duplicate.pointer,
    });
  }
  if (
    typeof index.entry === "string" &&
    index.entry !== "" &&
    !index.columnPointers.has(index.entry)
  ) {
    out.push({
      code: "missing-entry",
      severity: "error",
      message: `入口列 ${index.entry} 不存在`,
      pointer: "/entry",
    });
  }
  for (const target of index.targets) {
    const found =
      target.kind === "column"
        ? index.columnPointers.has(target.target)
        : target.kind === "function"
          ? index.functions.has(target.target)
          : // callable：列或 func **任一存在**即通过
            index.columnPointers.has(target.target) || index.functions.has(target.target);
    if (!found) {
      out.push({
        // `"function"` 分支当前**无字段产出**（`call` 用的是 `callable`）——
        // 保留它是**契约完备性**（`TargetKind` 有三种，判定要覆盖三种），
        // 将来若出现「只允许 func」的新字段即可直接复用（当前无产出路径，非冗余代码）。
        code: target.kind === "function" ? "unknown-function" : "missing-target",
        severity: "error",
        message:
          target.kind === "column"
            ? `跳转目标列不存在：${target.target}`
            : target.kind === "function"
              ? `调用未注册的函数：${target.target}`
              : `调用目标不存在：${target.target}（既不是 func 也不是列）`,
        pointer: target.pointer,
      });
    }
  }
  for (const ref of index.variableRefs) {
    if (ref.name.startsWith("_")) continue;
    if (index.definedKeys.has(ref.name)) continue;
    out.push({
      code: "undefined-variable",
      severity: ref.kind === "expression" ? "error" : "warning",
      message:
        ref.kind === "expression"
          ? `未定义变量：${ref.name}（表达式里使用，求值会失败并**停机**——请先用 set/define 定义它）`
          : `未定义变量：${ref.name}（插值失败将按原文保留——若它应是变量请先定义，若只是普通文字请去掉花括号）`,
      pointer: ref.pointer,
    });
  }
  if (options.resourceFiles !== undefined) {
    for (const resource of index.resources) {
      if (!options.resourceFiles.has(resource.path)) {
        out.push({
          code: "missing-resource",
          // 提醒级：素材"先写引用后补"是正常工作流，
          // error 会拦保存门禁；运行期缺资源由运行时自己 fail-closed 兜底。
          severity: "warning",
          message: `资源路径不存在：${resource.path}`,
          pointer: resource.pointer,
        });
      }
    }
  }
  if (options.overlayKeys !== undefined) {
    for (const key of options.overlayKeys) {
      if (!index.originals.has(key)) {
        out.push({
          code: "unused-translation",
          severity: "warning",
          message: `未使用的译文键：${key}（say / menu / input / notify 四个翻译面均未命中原文——该键运行期不会生效；若这段文字只用于元素文本或宿主界面，本条可忽略）`,
          pointer: "",
        });
      }
    }
    // 缺译（正向，与 unused-translation 反向对称）：原文在**全部语言**的 overlay
    // 里都没有 = 玩家必然看到原文（提醒级，不拦保存）。仅在「工程确实启用了 i18n」
    // （overlay 非空）时提醒——不启用 i18n 的工程原文直出是常态（"不需要多语言
    // 就不需要 i18n"），不制造全量噪声。
    if (options.overlayKeys.size > 0) {
      for (const original of index.originals) {
        if (!options.overlayKeys.has(original)) {
          out.push({
            code: "missing-translation",
            severity: "warning",
            message: `原文未有任何译文：${original}（所有语言的 overlay 均未命中——运行期回退原文；专有名词等有意保留原文的可忽略）`,
            pointer: "",
          });
        }
      }
    }
  }
  // 未实现属性清单：已声明但**当前无渲染语义**的元素属性（写了不生效且静默）→ warning。
  // 指针精确到该属性；清单与表单下架同源（`UNIMPLEMENTED_ELEMENT_ATTRS`），避免两份事实。
  walkStoryElements(story, (node, pointer) => {
    if (!isPlainObject(node)) return; // 非对象由 invalid-element 负责
    for (const attr of UNIMPLEMENTED_ELEMENT_ATTRS) {
      if (node[attr] === undefined) continue;
      out.push({
        code: "unimplemented-element-attr",
        severity: "warning",
        message: `元素属性 ${attr} 已声明但当前无渲染语义（写入不生效）`,
        pointer: `${pointer}/${escapePointerToken(attr)}`,
      });
    }
    // 点击动作序列里的**执行期必拒** op：编辑期即报，别等运行时才发现点不动。
    // 清单与执行期同源（引擎契约 `ELEMENT_OPS_BLOCKED`）——两处各写一份必然漂移。
    const ops = node.ops;
    if (Array.isArray(ops)) {
      ops.forEach((item, i) => {
        if (!isPlainObject(item)) return; // 形态问题由 invalid-element 负责
        const op = item.op;
        if (typeof op !== "string" || !ELEMENT_OPS_BLOCKED.has(op)) return;
        out.push({
          code: "element-ops-blocked-op",
          severity: "error",
          message: `元素动作序列里的 ${op} 不可用（等待/位置/存档类会打断当前叙事流）；跳列请用 nav 属性`,
          pointer: `${pointer}/ops/${i}`,
        });
      });
    }
  });
  return out;
}
