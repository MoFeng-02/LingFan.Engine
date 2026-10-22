/**
 * 短标识形态：引擎里用作「命名空间段」的标识（扩展 id、玩法系统 id）共用同一套写法。
 *
 * 形态：小写字母开头，其后是小写字母 / 数字 / `_` / `-`，总长 1..32。
 * 统一小写是为了让同一个系统不出现 `Foo` 与 `foo` 两种写法；
 * 限长是为了让它作为状态键的一段（`ext.<extensionId>.<key>`、`game.<systemId>.<key>`）
 * 时仍然短小可读。
 *
 * 形态只在这里写一份，`EXTENSION_ID_PATTERN` 与 `GAME_SYSTEM_ID_PATTERN` 都指向它：
 * 将来要放宽或收紧，只改这里一处，不会漏掉另一处。
 */
export const SHORT_ID_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
