/**
 * 类型生成器的输入形状。
 *
 * 生成器只吃「已经算好的字符串域」，不自己去扫源码：列 id 来自编译结果、state 键来自
 * config 状态降维、变量键来自 config.vars、声明名来自产物 op 流、扩展 id 来自清单装载。
 * 这样生成器与编排层的数据来源始终是同一份，不会出现「构建按 A 判定、IDE 按 B 提示」。
 */

/** 一次类型面生成所需的全部字符串域 */
export interface TypegenInput {
  /** 列 id：default 导出函数名，jump/option target 的值域 */
  readonly columns: readonly string[];
  /** config 状态（形态 A state / 形态 B define 合并树）降维后的扁平点路径键 */
  readonly schemaKeys: readonly string[];
  /** config.vars（config.ts 的 vars 导出键集对象）登记的变量键 */
  readonly defineKeys: readonly string[];
  /** 产物 op 流里出现过的声明名（let/for/input/store 等） */
  readonly declaredNames: readonly string[];
  /** 清单装载到的扩展 id（存 `demoquest`，不含 `ext.` 前缀与尾点） */
  readonly extensionPrefixes: readonly string[];
}
