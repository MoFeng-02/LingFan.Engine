/**
 * schema 域出口：op 全集定义（单一事实源）同时驱动属性面板表单派生与编辑期校验，
 * 另含表单/元素描述符、op 分组清单、故事校验与命令体遍历器。
 */
export { OP_META, FIELD_META, fieldMetaOf } from "./catalog.ts";
export {
  UNIMPLEMENTED_ELEMENT_ATTRS,
  describeElement,
  listElementTypes,
  elementLabel,
  specificAttrsOf,
  type ElementFormDescriptor,
} from "./elementForms.ts";
export {
  ELEMENT_TYPE_GROUPS,
  OP_GROUP_ORDER,
  OP_GROUP_LABELS,
  listOpGroups,
  type ElementTypeGroup,
  type OpGroupEntries,
} from "./elementPalette.ts";
export {
  describeForm,
  listOps,
  describeNodeLabel,
  coerceFieldValue,
} from "./forms.ts";
export {
  OP_SCHEMAS,
  validateCommand,
  type ScriptOpName,
  type CommandOf,
  type ScriptCommand,
  type ScriptValue,
  type StateScriptValue,
} from "./opSchemas/index.ts";
export {
  BUILTIN_OP_SURFACE,
  mergeOpSchemas,
  mergeOpMeta,
  mergeOpSurface,
  type OpSurface,
} from "./surface.ts";
export { columnSchema, storySchema, validateStory } from "./validation.ts";
export {
  walkCommandBodies,
  walkStoryCommands,
  walkStoryElements,
  type CommandVisitor,
  type ElementVisitor,
} from "./walk.ts";
