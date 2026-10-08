/**
 * schema 域出口：op 全集定义（单一事实源）同时驱动属性面板表单派生与编辑期校验，
 * 另含表单/元素描述符、op 分组清单、故事校验与命令体遍历器。
 */
export { OP_META, FIELD_META, fieldMetaOf } from "./catalog";
export {
  UNIMPLEMENTED_ELEMENT_ATTRS,
  describeElement,
  listElementTypes,
  elementLabel,
  specificAttrsOf,
  type ElementFormDescriptor,
} from "./elementForms";
export {
  ELEMENT_TYPE_GROUPS,
  OP_GROUP_ORDER,
  OP_GROUP_LABELS,
  listOpGroups,
  type ElementTypeGroup,
  type OpGroupEntries,
} from "./elementPalette";
export {
  describeForm,
  listOps,
  describeNodeLabel,
  coerceFieldValue,
} from "./forms";
export {
  OP_SCHEMAS,
  validateCommand,
  type ScriptOpName,
  type CommandOf,
  type ScriptCommand,
  type ScriptValue,
} from "./opSchemas";
export {
  BUILTIN_OP_SURFACE,
  mergeOpSchemas,
  mergeOpMeta,
  mergeOpSurface,
  type OpSurface,
} from "./surface";
export { columnSchema, storySchema, validateStory } from "./validation";
export {
  walkCommandBodies,
  walkStoryCommands,
  walkStoryElements,
  type CommandVisitor,
  type ElementVisitor,
} from "./walk";
