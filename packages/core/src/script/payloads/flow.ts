/**
 * 流程域 op 负载：wait / if / jump / navigate / call / return /
 * pause / random / func / while / assert / guard / for / foreach / switch /
 * break / continue。
 *
 * 负载用 type 别名而非 interface：TS 只给对象字面量类型隐式索引签名，
 * CommandOf 产物要能赋给 StoryCommand（开放索引签名），负载必须是
 * 字面量类型形态。块体是 unknown[]：嵌套命令的校验归校验器递归。
 */
import type { EmptyOpPayload, ScriptBody, ScriptValue } from "./shared.ts";

/** wait：限时等待，skipable 允许点击跳过 */
export type WaitOpPayload = {
  seconds: number;
  skipable?: boolean;
};

/** if 的 elif 分支 */
export type IfBranch = {
  cond: string;
  then: ScriptBody;
};

/** if：条件分支（elif 链 + else 兜底） */
export type IfOpPayload = {
  cond: string;
  then: ScriptBody;
  elif?: IfBranch[];
  else?: ScriptBody;
};

/** jump：跳转到本列内的列名标号 */
export type JumpOpPayload = {
  target: string;
};

/** navigate：跨列导航，scene 缺省走当前场景 */
export type NavigateOpPayload = {
  path: string;
  scene?: string;
};

/** call：调用函数列；into 是结果绑定的状态槽键（缺省丢弃返回值） */
export type CallOpPayload = {
  target: string;
  args?: ScriptValue[];
  into?: string;
};

/** return：函数列返回；value 缺省表示无返回值 */
export type ReturnOpPayload = {
  value?: ScriptValue;
};

/** pause：硬等待（不可跳过），与 wait 的 skipable 语义相对 */
export type PauseOpPayload = {
  seconds: number;
};

/** random：区间随机写入状态槽。seed 的 int 约束在校验器侧；range 是二元组 */
export type RandomOpPayload = {
  seed: number;
  range: [number, number];
  var: string;
};

/** func：函数列定义，name/params/body 三者引擎均必填 */
export type FuncOpPayload = {
  name: string;
  params: string[];
  body: ScriptBody;
};

/** while：条件循环 */
export type WhileOpPayload = {
  cond: string;
  body: ScriptBody;
};

/** assert：断言，失败时 message 作诊断文案 */
export type AssertOpPayload = {
  cond: string;
  message?: string;
};

/**
 * guard：守卫调用。args 是原样**运输**的宿主参数：嵌套 JSON 合法
 * （运行期 findJsonValueError 兜底 JSON 安全）。值口径原则：被求值的走
 * ScriptValue（call args / set），被运输的走 JSON（guard args）。
 */
export type GuardOpPayload = {
  fn: string;
  args?: Record<string, unknown>;
};

/** for：数值区间循环，in 是区间表达式 */
export type ForOpPayload = {
  var: string;
  in: string;
  body: ScriptBody;
};

/** foreach：集合遍历，var 收值、key 收键 */
export type ForeachOpPayload = {
  var: string;
  key: string;
  body: ScriptBody;
};

/** switch 分支：value 是被求值的匹配值（ScriptValue），body 是块体 */
export type SwitchCaseSpec = {
  value: ScriptValue;
  body: ScriptBody;
};

/** switch：多路分支。cases 至少一项（min(1) 在校验器侧） */
export type SwitchOpPayload = {
  on: string;
  cases: SwitchCaseSpec[];
  default?: ScriptBody;
};

/** 流程域 op → 负载登记（域 map 住域文件，总登记只 extends） */
export interface FlowPayloadMap {
  wait: WaitOpPayload;
  if: IfOpPayload;
  jump: JumpOpPayload;
  navigate: NavigateOpPayload;
  call: CallOpPayload;
  return: ReturnOpPayload;
  pause: PauseOpPayload;
  random: RandomOpPayload;
  func: FuncOpPayload;
  while: WhileOpPayload;
  assert: AssertOpPayload;
  guard: GuardOpPayload;
  for: ForOpPayload;
  foreach: ForeachOpPayload;
  switch: SwitchOpPayload;
  /** 空负载：CommandOf 特判产 { op: K }，不收任何字段 */
  break: EmptyOpPayload;
  continue: EmptyOpPayload;
  /** 回退控制：op 级临时锁定/解锁回退，无参数（写 SYS.rollbackLocked） */
  block_rollback: EmptyOpPayload;
  fix_rollback: EmptyOpPayload;
}
