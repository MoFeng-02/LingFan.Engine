/**
 * 列身体域的出口：进列时把 `column.body` 对账进 `SYS.body`。
 *
 * 这一域只有状态对账，不碰渲染——读这一屏画谁归宿主（`packages/ui/src/body`）。
 * 这里只做转发，不放任何实现。
 */
export { loadBody } from "./load.ts";
