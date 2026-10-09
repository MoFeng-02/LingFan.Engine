/**
 * 元素与效果族的出口：元素增删改与对话框显隐、元素动画与屏幕效果、
 * 元素动作序列。
 *
 * 域内各文件之间按需直接引用；这里只做转发，不放任何实现。
 */
export { execElementVisual, execWindow } from "./visual";
export { execAnimate, execScreenEffect, execTextTypewriter } from "./animation";
export { runElementOps } from "./sequence";
