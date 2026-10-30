/**
 * 生成物目录名的唯一声明。
 *
 * 这个概念此前有两份独立声明——`pipeline/orchestrate.ts` 的 `DEFAULT_GENERATED_DIR`
 * 与 `compiler/.../graph/core.ts` 的 `GEN_PREFIX`（同一目录的带斜杠写法），另有六处
 * 现场手拼 `"gen"` / `"gen/"`。判定分散在发现域、编译器域、监听域与 UI 门禁域四处，
 * 但判的是同一个目录，故下沉到不依赖任何业务域的 `shared/`，各处引用同一份。
 *
 * 为什么不能就近放：编译器域不能依赖 `pipeline/`（`pipeline/` 依赖 `compiler/`，
 * 反向成环），而 `config/`、`discovery/`、`ui/` 又不依赖 `compiler/`——四个方向都要
 * 用，只有 `shared/` 站得住。
 */

/**
 * 生成物目录名：相对**源根的父目录**（默认布局下 = `src/gen`），不是相对源根。
 *
 * 为什么放在源根之外：生成物是「要被编译进前端工程的模块」，故事源是「只归
 * stories-build 的创作源」。同住 `src/` 之下后，前端工程里没有任何路径指向
 * `Stories.src/`，故事源因此结构上不可能被打包器收进最终 JS（不必靠「碰巧没人
 * import」）。
 */
export const DEFAULT_GENERATED_DIR = "gen";

/**
 * 生成物目录的**路径前缀**形式（`gen/`）：`rel.startsWith(GEN_PREFIX)` 判「在此目录之下」。
 *
 * 带不带尾斜杠是两件事，别混用——`DEFAULT_GENERATED_DIR` 匹配目录名本身
 * （`entry === DEFAULT_GENERATED_DIR`，用于「整目录被列为源目录」这种判定），
 * `GEN_PREFIX` 只匹配其下的条目（`gen/x.ts` 是生成物，`gen_backup/x.ts` 不是）。
 */
export const GEN_PREFIX = `${DEFAULT_GENERATED_DIR}/`;
