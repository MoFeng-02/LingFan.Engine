/**
 * op 负载共享片段：被多条命令 schema 复用的最小判定单元，一处定义防漂移。
 */
import { z } from "zod";

const NonEmpty = z.string().min(1);
const SlotName = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "槽位名必须为字母数字/_/-，1..64");
const Value = z.union([z.string(), z.number(), z.boolean()]);
/**
 * 状态类 op 的值域 = 共享 Value + null：状态槽允许「空值」占位
 * （初始未定 / 条件性覆盖），变量销毁走 undef（undefined 永不入值域）。
 * 不并入 Value：say/nvl 等叙事字段与 call/return/switch 等共享面
 * 保持标量域，null 只属于状态槽位（set/define/let/local/array 族/dict 族）。
 */
const StateValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const Body = z.array(z.unknown());
const Finite = z.number().finite();
const Fade = z.number().finite().min(0);
/** 实例级 z：非负有限数；仅拥有独立渲染层的命令接受 */
const InstanceZ = z.number().finite().min(0).optional();

export { NonEmpty, SlotName, Value, StateValue, Body, Finite, Fade, InstanceZ };
