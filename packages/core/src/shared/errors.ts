/**
 * 错误码判定：把运行期到手的 `unknown` 值收窄成契约里声明的已知错误码。
 *
 * 契约层只声明错误码目录与类型（零实现）；判定实现集中在这里，
 * 与 `shared/guards.ts` 的形状判定同层同口径：判不过不抛错也不兜底，
 * 由调用方走兜底分支（目录外的合法扩展码不被误判为已知码）。
 */
import {
  ENGINE_ERROR_CODES,
  type EngineErrorCode,
} from "../contracts/runtime/errors.ts";

const ENGINE_ERROR_CODE_SET: ReadonlySet<string> = new Set(ENGINE_ERROR_CODES);

/**
 * 错误码守卫：把未知值收窄为已知 EngineErrorCode。
 * 目录外的字符串（如扩展宿主自有码）返回 false——调用方据此走兜底分支，而非误判。
 */
export function isEngineErrorCode(value: unknown): value is EngineErrorCode {
  return typeof value === "string" && ENGINE_ERROR_CODE_SET.has(value);
}
