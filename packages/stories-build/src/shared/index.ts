/**
 * 通用出口：失败类型、文件遍历、目录布局名、追溯上限与集中文案表。
 *
 * 这几样跨域用得多——`StoryBuildError` 被十来个文件当统一失败口径，
 * `walkFiles` 被发现、写盘、编译器三处共同依赖，`DEFAULT_GENERATED_DIR` /
 * `GEN_PREFIX` 被发现、编译器、监听、UI 门禁四域共用（判的是同一个生成物目录），
 * `MAX_ALIAS_HOPS` 被编译器与类型生成两域共用（同一条类型别名链的两端），
 * `StoriesBuildTexts` 是构建期全部可注入文案的唯一出处（缺省实现 = 现场字符串）——
 * 放进任何业务域都会让别的域为了一个工具反向依赖它，故单独成域。
 */
export { StoryBuildError } from "./errors.ts";
export { DEFAULT_GENERATED_DIR, GEN_PREFIX } from "./generated-dir.ts";
export { MAX_ALIAS_HOPS } from "./limits.ts";
export { walkFiles } from "./walk-files.ts";
export { defaultStoriesBuildTexts, type StoriesBuildTexts } from "./texts.ts";
