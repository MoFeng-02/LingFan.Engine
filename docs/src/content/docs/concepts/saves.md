---
title: 存档系统
description: 存档记的是等待点坐标、全局状态、随机数种子和历史。它跟回溯是两套东西，读档后引擎按坐标重放，重建出你当时看到的那一屏。
---

存档和回溯都会「回到过去」，但机制不同。回溯在内存里回到检查点，存档把一份数据写到磁盘上，关掉浏览器还在。

## 存一个档

在故事里声明：

```text
  save "slot_1" title "第一章"
```

`save` 不是等待命令——它记下「下一个画面写进这个槽」，然后继续往下走。玩家看到的那一屏出现时，引擎才真正落盘，然后发 `save.done` 事件。

也可以从宿主调命令面：

```ts
engine.save("slot_1", { title: "第一章" });
```

这条要求当前在等待点上，否则报 `save-invalid`「当前不在等待点，无法存档」。槽位名限字母数字、`_`、`-`，长度 1 到 64，违规报 `save-invalid-slot`「槽位名非法：X（字母数字/_/-，1..64）」。

没装配存档端口（构造引擎时没给 `savePort`）时，`save()` 固定返回 `false`，事件里报 `save-unavailable`「未装配 SavePort（组合根经 EngineOptions 注入）」。

## 槽位从哪来

`Resources/project.json` 里的 `shell.saves.slots`：

```json
{
  "shell": {
    "saves": {
      "slots": 6
    }
  }
}
```

取 1 到 32 的整数，缺省 6。槽位 id 是 `slot_1` … `slot_N`，宿主用 `slotIds()` 拿这张表，别自己拼字符串。`save` 命令和 `engine.save()` 用的槽位名就是这个。

`auto_save` 用的是另一个固定槽 `auto`，不占上面的编号。

## 存档里有什么

```ts
{
  formatVersion: 1,
  storyId: "my-story",
  title: "第一章",        // 可选
  coord: { columnId: "chapter_one", index: 12 },
  state: [["player.name", "阿岚"], ["coins", 30], ...],
  rngState: 1735689600,
  functions: [...],
  cursor: 7,
  history: [...],
  screenshot: "...",      // 可选
  extensions: [{ id: "demo", stateVersion: 1 }]  // 用到扩展时才有
}
```

几个要留意的：

- `coord` 指向**能重建那一屏的列内位置**。读档不是把画面截图贴回来，是从这个坐标重放，重新执行一遍命令。
- `state` 是全局层。块级和列级变量不进档，读档后按同样的代码重新声明——所以它们的值只要由代码确定，读档后就是对的。
- `rngState` 是随机数种子。同一个档读两次，`random` 抽到的序列一样。
- `history` 只留每个检查点的坐标、状态和种子，不留帧栈——帧栈由坐标重建。
- `extensions` 只在故事真的用过扩展时才出现。没用过就没有这个字段，装了扩展的引擎也能读没扩展的档。

在 `menu` 或 `ui` 类型的列里存档，存下来的是**进入这个菜单之前的游戏进度**，不是菜单本身。如果找不到那个进度，报 `save-invalid`「当前在菜单/界面中，且没有可返回的游戏进度——无法存档（请先回到游戏场景）」。

## 什么存不进去

存档前引擎会逐个值检查能不能序列化。状态里塞了函数、`Map`、循环引用这类东西，报 `value-not-serializable`：

```text
状态含不可序列化值，存档被拒绝：player.data（请检查是否有原地修改已写入的值；应整值替换）
```

最常见的来源是原地修改：拿一个数组 `push` 完再 `set` 回去。写时复制要求整值替换。

```text
  array_push "inventory" "钥匙"     // 对
```

`array_push`、`dict_set` 这些命令都是写新引用，不会踩到这个坑。自己写的扩展 op 里直接改对象才会。

## 存档模式

`machine-bound`（默认）和 `portable` 两种。

前者跟当前机器绑定，把存档文件拷到另一台机器上打不开——它本来就是给「本机进度」用的。需要跨设备就用 `portable`，在构造引擎时指定：

```ts
new StoryEngine(story, { savePort, saveMode: "portable" });
```

这个参数引擎自己不用，它原样交给 `savePort.write(slot, payload, mode)`。**引擎不持密钥，也不做加解密**——它负责编排载荷（坐标、全局状态、随机数种子、历史）和管好槽位，密文怎么生成、跟什么绑定，都在端口实现里。

所以「存档安不安全」这个问题，答案在平台层：

- 引擎给的 `SaveMode` 只是一个口径声明，`machine-bound` 表示「这份档离开这台机器就不该能读」。
- 密钥从哪来、绑定什么、用什么算法，是端口实现的事，故事和引擎都插不上手。
- 防回档也是平台层的：存档带写入计数，删掉较新的档再读一个更旧的档会被拒——不然删档就成了回档的后门。这条在[删档](#删档)那节能看到效果。

需要跨机分发，除了把 `mode` 改成 `portable`，端口实现也得真的产出一份跟机器无关的密文。引擎侧改这一个参数就够，剩下的在平台层。

## 读档

```ts
engine.load("slot_1");
```

异步完成：读回原始数据、校验、恢复全局态、按坐标重放，重建出那一屏。成功后发 `load.done`，失败只发 `engine.error`，状态保持原样。

校验挡下这些情况：

| 错误码 | 什么时候 |
|---|---|
| `save-format` | 存档结构不完整、历史检查点缺字段、`cursor` 类型不对 |
| `save-story-mismatch` | `storyId` 对不上，或者档里的列在当前故事里不存在了 |
| `load-invalid-slot` | 槽位名不合法 |
| `load-failed` | 槽位读不出来或者 JSON 解析失败 |
| `save-unavailable` / `load-unavailable` | 没装配存档端口 |

第二行是改故事时最容易撞上的：你删了或改名了一个列，玩家手上的旧档就报「该存档与当前故事版本不匹配（列定义已变更）」。存档坐标指向的列必须还在。

`importSave(data)` 可以拿一份自己造的 `SaveDataV1` 直接读，走同一套校验。

## 自动存档

```text
  auto_save true
  say "这段剧情之后会自动存。"
  auto_save false
```

开着的时候，每个等待画面建立时写一次 `auto` 槽。这个开关是系统状态，随状态一起进存档（存档导出全量无过滤，`export.ts:74`）、读档后原样恢复（全量恢复，`import.ts:85`，只复位等待标记 `import.ts:125`）——读档点之前开着的自动存档，读档后仍然是开的，不用重新开。

`save` 声明的待写和自动存档撞在同一屏时，只写 `save` 声明的那个槽——一屏只写一次。

## 删档

```ts
engine.save_delete("slot_1");
```

在故事里就是 `save_delete "slot_1"`。删掉槽位内容，但不动它的写入计数——防回档的基准不跟着回退。用 `list()` 能看每个槽的写入次数和时间戳：

```ts
await savePort.list();
// [{ slot: "slot_1", saveCount: 3, timestamp: 1735689600, mode: "machine-bound" }]
```

## 缩略图

`shell.saves.thumbnail` 控制存档缩略图：

```json
{
  "shell": {
    "saves": {
      "thumbnail": { "width": 320, "height": 180, "quality": 0.7, "showText": true }
    }
  }
}
```

宽 80 到 1280，高 45 到 720，`quality` 在 0 到 1 之间。截图由宿主生成后经 `save(slot, { screenshot })` 传进来，引擎只负责把它放进存档载荷。

## 偏好不进存档

音量、文字速度、按键映射这些玩家偏好不写在存档里，也不跟着读档变。它们单独落盘，换存档不影响设置。详见[玩家偏好](/guides/dialogue/)一节（如果宿主还没接偏好面板，音量就取命令里写的值）。

## 下一步

- [回溯与历史](/concepts/rollback/)：不落盘的另一种「回到过去」。
- [扩展引擎](/concepts/extensions/)：扩展的状态怎么跟着存档走。
- [工程结构](/project-structure/)：`shell` 配置写在哪个文件里。
