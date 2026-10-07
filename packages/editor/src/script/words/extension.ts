/**
 * Script 词汇层 · **扩展域**（extOp 通用出口）。
 *
 * 扩展 op = 宿主经 `EngineOptions.extensions` 注册的自定义 op。本出口只产
 * 数据、不持白名单——持有就是重复定义真相。放行与否归两端把守：
 * - **构建期**：清单 `extensions` 声明扩展模块 → `buildStories` 校验故事里的 op 名
 *   是否被声明扩展提供（未被放行 = 构建期拦截，fail-early）；
 * - **运行期**：opRegistry 注册制，未注册 = `unknown-op` fail-closed。
 */
import type { StoryCommand } from "@lingfan/engine";

/** 扩展 op 通用构造：op 恒由首参决定（负载展开在前、op 在后——负载不得劫持 op 键） */
export function extOp(
  op: string,
  payload?: Record<string, unknown>,
): StoryCommand {
  return { ...payload, op };
}
