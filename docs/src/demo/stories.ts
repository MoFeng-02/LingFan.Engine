/**
 * 内置极小故事（demo 页数据源）：TS 字符串常量内联，零 fetch、零资源文件。
 *
 * 文本形态是引擎 story DSL 的**规范投影形**（2 空格缩进、字段序固定）——
 * 往返自检会断言 `generateText(parseTextStory(text)) === text` 逐字节成立，
 * 所以这里的手写文本必须保持规范形。每列 ≤ 8 条命令。
 */

export interface DemoStoryMeta {
  /** 故事 id：parseTextStory 的文档 id，也是组装时 Stories/<id> 文件名的来源 */
  id: string;
  /** 选择器按钮上的短标题 */
  title: string;
  /** 一句话说明这条故事演示什么 */
  desc: string;
  /** story DSL 文本（规范形） */
  text: string;
}

export const DEMO_STORIES: readonly DemoStoryMeta[] = [
  {
    id: "greeting",
    title: "迎宾与变量",
    desc: "say / input / set / if-else / notify / define",
    text: `define "player.gold" 12
label start:
  say "欢迎来到灵泛引擎的文档站 demo。" speaker="灵泛"
  say "你身上有 {player.gold} 枚金币，够买一盏灯。"
  input "旅人，报上名来：" store="player.name"
  if {player.gold >= 10}
    set "player.gold" {player.gold - 10}
    notify "花 10 枚金币买了一盏灯，剩 {player.gold} 枚。" type="info"
  else
    notify "金币不足，灯先欠着。"
  say "你好，{player.name}！切到「源码」改改这段文字，再应用看看。"
  jump end
label end:
  say "（这一段就是一条 story DSL 跑起来的样子。）" speaker="灵泛"
  return
`,
  },
  {
    id: "crossroads",
    title: "岔路与菜单",
    desc: "menu / jump / set / if-else / return",
    text: `define "player.tavern" 0
label start:
  say "路口立着木牌：左边是酒馆，右边是广场。" speaker="旁白"
  menu "往哪走？"
    "去酒馆" -> tavern
    "去广场" -> square
label tavern:
  set "player.tavern" {1}
  say "酒馆里炉火正旺，你找了张空桌坐下。"
  jump end
label square:
  set "player.tavern" {0}
  say "广场上人声嘈杂，喷泉映着灯光。"
  jump end
label end:
  if {player.tavern > 0}
    say "（你在酒馆度过了这个夜晚。）"
  else
    say "（你在广场吹了一会儿风。）"
  return
`,
  },
  {
    id: "tour",
    title: "三列速览",
    desc: "jump 链 / wait / menu / 富文本",
    text: `label start:
  say "一段三列跳转的速览。" speaker="旁白"
  jump hall
label hall:
  notify "进入大厅。" type="info"
  wait 1.5 skipable
  menu "接着看什么？"
    "看看告示板" -> board
    "直接谢幕" -> finale
label board:
  say "告示板写着：{b}每一个 op 都有自己的文档页{/b}。"
  jump finale
label finale:
  say "速览结束。到「源码」里加一列试试。" speaker="旁白"
  return
`,
  },
];
