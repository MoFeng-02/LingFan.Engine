/**
 * Script 词汇层出口（core 侧）：命令类型机制 + op 负载声明 + 词函数与注册表。
 *
 * 源码直编（零构建）：消费方经包名 `@lingfan-engine/core/script` 子路径取用，
 * 列身体组件与非 JSON op 无需经过 editor 即可 import 引擎 op。
 * 词函数是纯数据构造（只返回 StoryCommand），注册表 interface 是字符串域
 * 类型扩充点——经包根再导出后由生成物 declare module 合并（三处规则）。
 */
export * from "./command.ts";
export * from "./payloads/index.ts";
export * from "./words/index.ts";
