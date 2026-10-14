/**
 * 通用出口：失败类型与文件遍历。
 *
 * 这两样跨域用得多——`StoryBuildError` 被十来个文件当统一失败口径，
 * `walkFiles` 被发现、写盘、编译器三处共同依赖——放进任何业务域都会
 * 让别的域为了一个工具反向依赖它，故单独成域。
 */
export { StoryBuildError } from "./errors.ts";
export { walkFiles } from "./walk-files.ts";
