/**
 * 源约定示例 + 三形态互锁夹具。
 * 约定：一个 .ts 文件 = 一个完整多列 Story，默认导出，
 * `satisfies Story` 提供编译期类型检查；运行期合法性由 parseStory（与 JSON 同口径）兜底。
 * 列 id 用语义化短 id。
 */
import type { Story } from "@lingfan/engine";

export default {
  formatVersion: 1,
  id: "tavern-demo",
  entry: "start",
  columns: [
    {
      id: "start",
      kind: "flow",
      commands: [
        { op: "say", text: "欢迎来到十字路口。", speaker: "旁白" },
        {
          op: "menu",
          prompt: "去哪里？",
          options: [
            { text: "进酒馆", target: "tavern" },
            { text: "下地窖", target: "cellar" },
          ],
        },
      ],
    },
    {
      id: "tavern",
      kind: "flow",
      commands: [
        { op: "say", text: "炉火噼啪作响。" },
        {
          op: "if",
          cond: "{gold > 10}",
          then: [{ op: "say", text: "你请了全场一轮。" }],
        },
        { op: "jump", target: "cellar" },
      ],
    },
    {
      id: "cellar",
      kind: "scene",
      elements: [
        { type: "panel", x: 40, y: 60 },
        { type: "text", text: "酒窖", x: 10, y: 10 },
      ],
      entry: [{ op: "say", text: "黑暗中有只木桶。" }],
    },
  ],
} satisfies Story;
