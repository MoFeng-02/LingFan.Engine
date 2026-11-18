/**
 * 语言清单的宿主侧出口。
 *
 * 清单由构建期扫描 `Resources/Lang/` 得出（`virtual:lang-list`），不是手写名单：
 * 加一个语言目录（或单文件 `Lang/{lang}.json`）不需要回来改任何声明——
 * 漏登记的后果是语言选择器里看不到那个语言，而磁盘事实不会漏。
 *
 * 组合根与各框架/壳入口都从这里取，不在自己的入口里各写一份。
 */
export { LANGS } from "virtual:lang-list";
