---
title: 不可回溯叙事：关掉回退的部署形态
description: 用 rollbackEnabled、historyLimit 与 game 列搭一条「只能向前」的叙事线，存读档照常。
---

有些故事刻意不要「回头」：一次性的抉择、限时挑战、 roguelike 式的单程旅程。引擎把「回退」当成一个可以整体关掉的部署开关，而不是散落在各处的特判——关掉之后，叙事语义不变，只是「回到上一句」这条路被收起来。

## 三个旋钮

| 旋钮                 | 写在哪                                                                  | 作用                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `rollbackEnabled`    | 引擎选项（组合根 `new StoryEngine(story, { rollbackEnabled: false })`） | 工程级总开关。`false` 时 `back` / `forward` / `rollbackTo` 一律拒绝，检查点不再累积。缺省 `true`，与既往行为完全一致。           |
| `shell.historyLimit` | `project.json` 的 `shell.historyLimit`（正整数）                        | 历史容量上限。设成 `1` 表示「只留当前这一帧」。非法值在组装期就被拒绝；运行期若仍收到非法值，引擎降级到内建默认 200 并出站诊断。 |
| `game` 列            | 故事源的列类型 `columnKind: "game"`                                     | 玩法列。把整段交给小游戏 / 交互系统，引擎让出控制权，本就不参与逐句回退。                                                        |

三者配合：`rollbackEnabled: false` 收起回退入口，`historyLimit: 1` 让历史不无限增长，`game` 列承载「玩完即走」的段落。

熟悉 Ren'Py 的作者可以这样对照：本引擎的 `rollbackEnabled: false` 等价于 Ren'Py 的一等配置 `config.rollback_enabled = False`——都是把「回退」当成一个整体开关关掉，叙事语义不变，而不是逐段打补丁。

## 关掉之后会怎样

- **回退被拒，状态原样。** 任何 `back` / `forward` / `rollbackTo` 调用都 fail-closed：引擎出站一条 `rollback-disabled` 诊断，画面与状态一字不动。宿主控件（滚轮回退、历史面板按钮）读引擎的唯一读面 `rollbackAvailable()`，据此隐藏或禁用——控件不另算一份判断。
- **检查点不累积。** `rollbackEnabled: false` 时引擎不再为每句话建检查点，历史长度保持为 0，长跑也不会把内存吃满。
- **存读档照常。** 存档走的是另一条路：`save` / `load` 与回退无关。玩家照样能存档、读档、继续上次进度；读档恢复的是「存档那一刻」，不是「回退到上一句」。

## op 级临时锁定

如果只想在某一小段里锁住回退（比如一段不可跳过的演出），而不关掉整个工程的回退，用两条命令：

```text
block_rollback
say "这一段里不能回头。"
fix_rollback
```

`block_rollback` 把会话级的锁定键置真，`fix_rollback` 解锁。锁定是**会话态**：进快照、不进存档——读档后锁定状态不残留。它和工程级 `rollbackEnabled` 是两层：`fix_rollback` 解得开 op 级临时锁，解不开工程级总开关。锁定期间回退被拒，诊断码是 `rollback-locked`。

## 宿主接线

组合根把开关传给引擎，宿主控件读 `rollbackAvailable()`：

```ts
const engine = new StoryEngine(story, {
  rollbackEnabled: false, // 工程级总开关
  historyLimit: 1, // 或由 project.json 的 shell.historyLimit 提供
});

// 滚轮回退、历史按钮都先问这一句，控件不另算一份
if (!engine.rollbackAvailable()) return;
engine.back();
```

`rollbackAvailable()` = 工程总开关 × op 级锁定，是宿主判断「能不能回退」的唯一事实源。引擎自身的 `back` / `forward` / `rollbackTo` 也走同一道守卫，所以即便某个控件漏判，状态也不会被改坏。

## 注意事项

- 关回退是**部署形态**，不是改叙事语义：`say` / `menu` / 变量 / 媒体一切照旧，只是「回头」这条路被收起。
- `historyLimit` 只影响历史容量，不影响存档；想要「单程但仍可存读」正是 `rollbackEnabled: false` + 正常存读档的组合。
- 旧档迁移时，历史检查点会逐条走同一套迁移管线；迁不动的检查点被单独截断并出站 `load.notice`，存档进度本身不受影响。
