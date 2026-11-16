/**
 * 列身体契约：这一屏画面由哪个组件画。
 *
 * 语义要点：
 * - **与 `kind` / `type` 正交**：`kind` 判「有没有舞台层与入口命令」，身体判「这一屏是谁画的」。
 *   一条 `flow` 列同样可以有身体（结算画面、纯展示页都可以这么做）。
 * - **与 `elements` 互斥**：两者都是「列的整屏画面」。同时声明意味着两个渲染器抢同一块
 *   画布，而且谁在上没有定义。需要「身体 + 引擎元素叠一层」时用 `mount`（叠加层语义
 *   本来如此）。
 * - **静态声明是「告知」不是「加载」**：产物里只有名字，组件本体住 `src/scenes/**`，
 *   由宿主按名字查注册表。引擎不读、不编译、不拷贝那些文件。
 */
export interface ColumnBody {
  /**
   * 组件名。语义 = `src/scenes/<名>/<名>.<ext>` 的目录名 = 注册表键 = 生成物里的具名导出。
   *
   * 三处必须相等（同 `src/ui/` 的既有约定）：放宽成「可以不等」会立刻产生三份真相。
   */
  readonly name: string;
  /**
   * 组件参数：**原样写入，引擎不求值**（与 `mount` op 一致）。
   *
   * 必须是 JSON 安全值（对象 / 数组 / 字符串 / 数字 / 布尔 / null）；
   * 含函数、`undefined`、`Symbol`、循环引用 ⇒ 装载期 fail-closed（`body-unsafe-props`）。
   *
   * 要在参数里表达动态值，由组件自己用 `SceneEnv.interpolate` 求值。
   */
  readonly props?: Readonly<Record<string, unknown>>;
}
