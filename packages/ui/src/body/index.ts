/**
 * 列身体域出口（唯一出口）：把引擎写的 `SYS.body` 变成「这一屏渲染谁、带什么入参」。
 *
 * 这一域只有纯判定，不碰 DOM、不认识框架——三种宿主形态各自把结果落到自己的渲染树上。
 * 判据因此可以脱离浏览器跑：同一对输入必得同一份结果。
 */
export { selectBody, type BodySelection } from "./selection.ts";
