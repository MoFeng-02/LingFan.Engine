/**
 * 执行帧与检查点。
 *
 * 解释器用帧栈表达「执行到哪」：列帧对应一条列，块帧对应 if/while/switch 这类块体。
 * 检查点是回溯与存档的最小单位：坐标（列 + 列内位置）加一份完整快照。
 * 这些结构只在运行层内部流转，不进包出口。
 */
import type {
  CharacterDef,
  ColumnCoordinate,
  StoryCommand,
} from "../../contracts/index.ts";
import type { ExprValue } from "../expr/index.ts";
import type { Scope } from "../scope.ts";

/**
 * 快照：状态 + 随机数状态 + 帧栈 + 函数表。
 * 不变量：状态容器的值写时复制（array/dict 每次写入新引用），故浅拷贝 entries 即安全。
 */
export interface EngineSnapshot {
  state: [string, unknown][];
  rngState: number;
  frames: Frame[];
  coord: ColumnCoordinate;
  /** 函数注册表随快照恢复——回溯到 func 之前的检查点重放时必须可重新注册 */
  functions: [string, { params: string[]; body: StoryCommand[] }][];
  /**
   * 全局层 undef 墓碑随快照——回滚到 undef 之前的检查点时，
   * 删除记录同步回退（读档垫底只看档内 deleted，但快照一致性要求随行）。
   */
  deleted: string[];
  /** 角色注册表随快照恢复——character 注册 / uncharacter 注销随回溯回滚 */
  characters: [string, CharacterDef][];
}

/** 检查点 = 坐标 + 快照；重放 = 恢复快照后从该命令重新解释执行到同一等待点 */
export interface Checkpoint {
  coord: ColumnCoordinate;
  snapshot: EngineSnapshot;
}

/**
 * 循环帧状态：while 每轮重判条件；for/foreach 物化数组逐元素推进
 * （foreach 编译为等价循环结构：len(expr) + expr[idx] 运行时求值）。
 */
export interface LoopState {
  kind: "while" | "iterate";
  /** while：条件表达式原文（每轮执行期重判） */
  cond?: unknown;
  /** iterate：循环变量名与物化元素序列 */
  varName?: string;
  items?: ExprValue[];
  /** 循环体外层作用域：每轮重建块级 */
  parentScope: Scope;
  iterations: number;
}

/**
 * 执行帧：列帧（columnId 非空，作用域 = 列级）与块帧（columnId 空，作用域 = 块级）。
 * 嵌套块不进坐标——坐标恒指列内顶层位置，块内进度由帧栈承载，
 * 快照时帧栈随状态一并保存即可满足确定性重放。
 */
export interface Frame {
  columnId: string | null;
  commands: readonly StoryCommand[];
  index: number;
  scope: Scope;
  /** 循环帧标记（break/continue 回溯锚点） */
  loop?: LoopState;
  /** 函数帧标记（return 回溯锚点；break/continue 不得跨函数边界） */
  func?: true;
  /**
   * 调用结果槽：execReturn 带值返回时写入调用方帧（call `into` 依据被调帧的
   * into 名把同一值声明进调用方作用域）。值走写时复制（ExprValue 全为不可变
   * 形态），克隆帧浅引用即可。
   */
  result?: unknown;
  /**
   * call into 的绑定名：execCall 从命令抄到被调帧上，return 与函数体自然跑完
   * （帧耗尽）两条路都据此回写调用方——中途经过存读档/回溯时随帧快照保留。
   */
  into?: string;
}
