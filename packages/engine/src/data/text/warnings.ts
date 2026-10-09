/**
 * 最近一次 `parseTextStory` 的**警告**（「语义暂未生效」类，不阻塞解析）。
 *
 * 警告**不是领域数据**，不该塞进 `Story`（会让往返深等失败——与 `sourcePath` 同一个道理），
 * 又不能改 `parseTextStory` 的返回类型（它是纯函数，契约只增不改）。
 * 折中：**模块级最近一次** + 调用方**立即取走**（解析与取用紧邻）。
 */
let lastWarnings: readonly string[] = [];

/** 记录本次解析产生的警告（解析入口内部调用；整次拒绝前也先记录，警告不随异常丢失） */
export function recordTextProjectionWarnings(list: readonly string[]): void {
  lastWarnings = list;
}

/**
 * 取走并清空最近一次解析的警告（无警告 ⇒ 空数组）。
 *
 * 与 `recordTextProjectionWarnings` 成对：解析入口写入，消费方取走一次即清空，
 * 免得陈旧警告被下一次读取误当成当次结果；连续两次取走，第二次必为空。
 */
export function drainTextProjectionWarnings(): readonly string[] {
  const out = lastWarnings;
  lastWarnings = [];
  return out;
}
