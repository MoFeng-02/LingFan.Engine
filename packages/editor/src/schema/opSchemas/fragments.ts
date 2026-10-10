/**
 * op 负载共享片段：被多条命令 schema 复用的最小判定单元，一处定义防漂移。
 */
import { z } from "zod";

const NonEmpty = z.string().min(1);
const SlotName = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "槽位名必须为字母数字/_/-，1..64");
const Value = z.union([z.string(), z.number(), z.boolean()]);
const Body = z.array(z.unknown());
const Finite = z.number().finite();
const Fade = z.number().finite().min(0);
/** 实例级 z：非负有限数；仅拥有独立渲染层的命令接受 */
const InstanceZ = z.number().finite().min(0).optional();

export { NonEmpty, SlotName, Value, Body, Finite, Fade, InstanceZ };
