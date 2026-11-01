/**
 * 外部玩法系统的状态写入面：把「作用域化键」与「是否触发观察事件」的四种组合
 * 收成 `GameStateWriter` 契约要求的五个方法。
 *
 * 两个入参是引擎侧的两条既有通道（外部写入 + 只读取值），这里只做组合，
 * 不复制键校验与值契约——那两条规则的唯一实现在 `../state/writer.ts`。
 */
import { gameScopedKey, type GameStateWriter } from "../../contracts/index.ts";

export function createGameState(
  write: (
    key: string,
    value: unknown,
    emitChange: boolean,
    systemId?: string,
  ) => boolean,
  read: (key: string) => unknown,
): GameStateWriter {
  return {
    set: (key: string, value: unknown): boolean => write(key, value, true),
    setSilent: (key: string, value: unknown): boolean =>
      write(key, value, false),
    setScoped: (systemId: string, key: string, value: unknown): boolean =>
      write(gameScopedKey(systemId, key), value, true, systemId),
    setScopedSilent: (systemId: string, key: string, value: unknown): boolean =>
      write(gameScopedKey(systemId, key), value, false, systemId),
    get: (key: string): unknown => read(key),
  };
}
