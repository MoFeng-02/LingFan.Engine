/**
 * 通用出口：失败类型、文件遍历与集中文案表。
 *
 * 这三样跨域用得多——`StoryBuildError` 被十来个文件当统一失败口径，
 * `walkFiles` 被发现、写盘、编译器三处共同依赖，`StoriesBuildTexts` 是
 * 构建期全部可注入文案的唯一出处（缺省实现 = 现场字符串）——放进任何
 * 业务域都会让别的域为了一个工具反向依赖它，故单独成域。
 */
export { StoryBuildError } from "./errors.ts";
export { walkFiles } from "./walk-files.ts";
export { defaultStoriesBuildTexts, type StoriesBuildTexts } from "./texts.ts";
