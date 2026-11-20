/**
 * 机器级持久数据（小程序）：微信同步存储上的明文 JSON，语义与 Web 演示实现共用同一份代码——
 * 没存过或存坏了都返回 `null`（上层用空基线起航，不因持久数据损坏挡住启动）。
 */
import type { PersistentPort } from "@lingfan-engine/core";
import { createWebStoragePersistentPort } from "../persistent/webStoragePersistent.ts";
import type { MiniprogramStorageLike } from "./platform.ts";
import { miniprogramStorageFace } from "./save.ts";

/**
 * 造一个持久数据端口（小程序）。
 * @param storage 微信同步存储面（宿主注入 `wx` 上那四个动作）
 */
export function createMiniprogramPersistentPort(
  storage: MiniprogramStorageLike,
): PersistentPort {
  return createWebStoragePersistentPort(miniprogramStorageFace(storage));
}
