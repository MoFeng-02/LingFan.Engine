/**
 * 故事清单的宿主侧出口。
 *
 * 清单由构建期扫描 `Resources/Stories/` 得出（`virtual:story-list`），不是手写名单：
 * 手写名单在「加了文件却忘了登记」时只会表现成运行期的 `unknown-column`，
 * 而磁盘事实不会漏。TS 创作链的产物与手写 `.story` 落在同一棵树，共用这一条扫描。
 *
 * 组合根与各框架/壳入口都从这里取，不在自己的入口里各写一份。
 */
export { STORIES } from "virtual:story-list";
