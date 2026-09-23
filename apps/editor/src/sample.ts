/** 编辑器初始示例故事（新建/首开用）：小而全——say/变量/分支体/菜单跳转 */
import type { Story } from "@lingfan/engine";

export function sampleStory(): Story {
  return {
    formatVersion: 1,
    id: "editor-demo",
    entry: "start",
    lang: "zh",
    defines: { "player.gold": 10 },
    columns: [
      {
        id: "start",
        kind: "flow",
        commands: [
          { op: "say", text: "欢迎打开灵泛编辑器。", speaker: "向导" },
          { op: "set", key: "player.gold", value: 10 },
          {
            op: "if",
            cond: "{player.gold >= 10}",
            then: [{ op: "say", text: "你带着盘缠。", template: "center" }],
            else: [{ op: "say", text: "你身无分文。" }],
          },
          {
            op: "menu",
            prompt: "去哪里？",
            options: [
              { text: "酒馆", target: "inn" },
              { text: "广场", target: "square" },
            ],
          },
        ],
      },
      {
        id: "inn",
        kind: "flow",
        commands: [
          { op: "bgm", resource: "Audio/inn.mp3", volume: 0.4, loop: true },
          { op: "say", text: "酒馆里暖烘烘的。", voice: "Audio/inn_line.ogg" },
          { op: "jump", target: "end" },
        ],
      },
      {
        id: "square",
        kind: "flow",
        commands: [
          { op: "say", text: "广场上只有风声。" },
          { op: "navigate", path: "end" },
        ],
      },
      { id: "end", kind: "flow", commands: [{ op: "say", text: "（完）" }] },
    ],
  };
}
