/**
 * Rust 命令错误的 TS 侧消费：把 invoke 拒绝负载解析成显式类型化的
 * `RustCommandError`（错误码 + 用户可读文案 + 原始详情），供各原生端口统一抛出。
 *
 * 为什么需要这一层：Rust 命令的错误枚举经 serde(tag="code", content="detail")
 * 过边界后是一个普通对象 `{ code, detail }`——直接 `String(e)` 会得到
 * "[object Object]"，错误码与详情全部蒸发，调用方无法区分「槽位不存在」与
 * 「检测到回档」这类语义完全不同的失败。本模块按 code 分支映射成可读文案，
 * 码表单一声明在核心契约的错误码目录（EngineErrorCode），这里只声明
 * 「Rust 边界码 → 用户可读标签」这一张映射表，不另立第二份码表。
 *
 * 怎么用：原生端口不直接调注入的 invoke，而是经 `invokeRust` 转发——
 * 成功路径原样透传，失败路径一律抛 `RustCommandError`（fail-closed，不静默吞）。
 * 无法识别的拒绝形态（字符串 / Error / 未知码 / 其他）落到兜底码并尽力保留
 * 可读信息，绝不产出 "[object Object]"。桥未装配的 `TauriBridgeError` 原样
 * 透传（「没壳」是配置问题，与「壳内命令失败」区分开）。
 */
import type { EngineErrorCode } from "@lingfan-engine/core";
import { TauriBridgeError, type TauriInvoke } from "./tauri-invoke";

/**
 * Rust 边界错误码 → 用户可读标签（单一映射表；键必须是错误码目录里的边界码）。
 * 标签只说「哪一类失败」，具体原因由 detail 补充；宿主可按 code 接 i18n 文案。
 */
export const RUST_ERROR_MESSAGES = {
  "app-data": "应用数据目录不可用",
  "bad-delete": "工程删除被拒绝",
  "bad-format": "数据格式损坏",
  "bad-json": "偏好数据不是合法 JSON",
  "bad-manifest": "工程清单损坏",
  "bad-mode": "壳模式参数非法",
  "bad-path": "工程路径非法",
  crypto: "加解密失败",
  decrypt: "工程资源解密失败",
  "invalid-path": "资源路径非法",
  "invalid-slot": "槽位名非法",
  io: "文件读写失败",
  keyring: "系统凭据库不可用",
  "missing-key": "资源密钥缺失",
  "missing-manifest": "缺少工程清单",
  "missing-stories": "缺少故事数据",
  "mobile-asset": "移动端资源不可用",
  native: "原生平台调用失败",
  "resource-dir": "资源目录不可用",
  "rollback-detected": "检测到回档",
  root: "工程根目录不可用",
  "too-large": "资源超出大小上限",
  "unknown-slot": "槽位不存在",
  watch: "工程监听失败",
  "watch-dev-only": "工程监听仅开发模式可用",
} as const satisfies Partial<Record<EngineErrorCode, string>>;

/** 兜底码：拒绝形态无法识别（无 code / 未知 code / 非对象）时使用 */
const FALLBACK_CODE = "rust-command-failed" satisfies EngineErrorCode;

/**
 * Rust 命令失败的类型化错误：`code` 供程序分支（如回档检测），
 * `message` 是用户可读文案，`detail` 保留原始负载供诊断（不参与展示拼接之外的用途）。
 */
export class RustCommandError extends Error {
  readonly code: EngineErrorCode;
  readonly detail: unknown;

  constructor(code: EngineErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = "RustCommandError";
    this.code = code;
    this.detail = detail;
  }
}

/** 详情文本化：字符串原样；对象 JSON 序列化；循环引用等序列化失败给类型描述 */
function detailText(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (detail === null || detail === undefined) return "";
  if (typeof detail === "object") {
    try {
      const json = JSON.stringify(detail);
      if (typeof json === "string") return json;
    } catch {
      // 循环引用等：落到类型描述，绝不产出 "[object Object]"
    }
    return "（详情无法序列化）";
  }
  return String(detail);
}

/** 已知 Rust 边界码 → 目录码 + 可读标签；未知码返回 undefined（走兜底） */
function knownRustCode(
  code: string,
): { code: EngineErrorCode; label: string } | undefined {
  if (Object.prototype.hasOwnProperty.call(RUST_ERROR_MESSAGES, code)) {
    const key = code as keyof typeof RUST_ERROR_MESSAGES;
    return { code: key, label: RUST_ERROR_MESSAGES[key] };
  }
  return undefined;
}

/**
 * 把任意 invoke 拒绝形态解析成 `RustCommandError`（幂等：已类型化原样返回）。
 * 分支顺序：已类型化 → 字符串（脚手架壳的可读错误）→ Error（保留 message）→
 * 带 code 的对象（Rust 枚举负载，按码映射）→ 其他（兜底 + 安全文本化）。
 */
export function parseRustError(error: unknown): RustCommandError {
  if (error instanceof RustCommandError) return error;
  if (typeof error === "string") {
    return new RustCommandError(
      FALLBACK_CODE,
      error === "" ? "原生命令失败（无错误详情）" : error,
    );
  }
  if (error instanceof Error) {
    return new RustCommandError(FALLBACK_CODE, error.message || error.name);
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const record = error as { code: unknown; detail?: unknown };
    if (typeof record.code === "string") {
      const detail = record.detail;
      const text = detailText(detail);
      const known = knownRustCode(record.code);
      if (known !== undefined) {
        const message = text === "" ? known.label : `${known.label}：${text}`;
        return new RustCommandError(known.code, message, detail);
      }
      const message =
        text === ""
          ? `原生命令失败（未知错误码 ${record.code}）`
          : `原生命令失败（未知错误码 ${record.code}）：${text}`;
      return new RustCommandError(FALLBACK_CODE, message, detail);
    }
  }
  const text = detailText(error);
  return new RustCommandError(
    FALLBACK_CODE,
    text === "" ? "原生命令失败（无错误详情）" : text,
    error,
  );
}

/**
 * 经错误解析转发一次 Rust 命令调用：成功原样透传；失败抛 `RustCommandError`。
 * 只包 invoke 本身——端口拿到结果后的编组逻辑不在保护范围内，
 * 避免把已类型化的错误二次包裹。桥未装配错误原样透传（配置问题单独区分）。
 */
export async function invokeRust<T>(
  invoke: TauriInvoke,
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (error instanceof TauriBridgeError) throw error;
    throw parseRustError(error);
  }
}
