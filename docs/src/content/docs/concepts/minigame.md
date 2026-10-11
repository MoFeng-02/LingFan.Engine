---
title: 小游戏与玩法系统
description: minigame 把控制权交给宿主注册的工厂，跑完回传结果；interaction 让玩法系统整屏接管。两者都不改叙事坐标，回溯会打断它们。
---

故事讲到一半要插一段玩法——猜拳、拼图、钓鱼、解谜——用 `minigame`。需要外部系统整屏接管（战斗界面、地图），用 `interaction`。

两者机制相同：引擎建立等待画面、把控制权交出去、等结果回来、按结果分流。引擎不关心玩法长什么样。

## 发起一个小游戏

```text
  minigame "coin_flip" on_success "win" on_fail "lose" config {rounds: 3} reward {coins: 10}
```

文法：

```text
minigame "game" [on_success "列"] [on_fail "列"] [config {…}] [reward {…}]
```

`game` 必填，是小游戏标识，写法限小写字母开头、小写字母/数字/`_`/`-`，最长 32 字符。不合法报「minigame.game 必填且为合法系统标识（匹配 /^[a-z][a-z0-9_-]{0,31}$/）」。

`config` 原样透传给宿主，引擎不解释里面的键。`reward` 是键值对，只有成功时写入。

执行到这条命令时：

1. 建立等待画面（`__waiting` 变 `minigame`）。
2. 记一个检查点——玩家在这里能回退，也能自动存档。
3. 发 `minigame.mount` 事件，带上 `game`、`config`、`seq` 和一个 `signal`。

`on_success`、`on_fail` 缺省时不跳转，原列继续往下走。

## 宿主注册工厂

引擎不管游戏怎么跑，它只认宿主注册表里的工厂：

```ts
const minigames = createMinigameRegistry();

minigames.register("coin_flip", async (host, ctx) => {
  const rounds = Number(ctx.config.rounds ?? 1);
  const result = await runCoinFlip(host, rounds, ctx.signal);
  return { outcome: result.won ? "success" : "fail", score: result.score };
});
```

工厂签名是 `(host, ctx) => Promise<MinigameResult>`：

| 参数 | 是什么 |
|---|---|
| `host` | 宿主提供的挂载容器。契约只说「有个能挂的东西」，具体类型由宿主自己收窄 |
| `ctx.config` | 命令里的 `config`，原样 |
| `ctx.signal` | 中止句柄，见下 |
| `ctx.seq` | 本次挂载的单调序号，用来区分重放 |

返回值：

```ts
{ outcome: "success" | "fail", score?: number, state?: Record<string, unknown> }
```

`score` 引擎不消费，留给界面显示。`state` 里的键会逐个落到 `game.<游戏标识>.` 命名空间下——工厂不用自己拼前缀，也不该裸写全局键。

注册表里没有这个 `game` 标识时**没有默认回退**。模板宿主会显示一条提示：「故事进入了小游戏等待：coin_flip。本模板不带小游戏注册表（fail-closed：不伪造完成）——要在宿主里支持，请用 `createMinigameRegistry` 注册，并在 mount 事件后调用 engine.resolveMinigame(result)。」不会假装玩过。

## 回传结果

```ts
engine.resolveMinigame({ outcome: "success", state: { best: 12 } });
```

成功时先把 `reward` 逐项写进状态，再按 `outcome` 跳到 `on_success` 或 `on_fail`。失败不写 `reward`，但 `state` 照写——输了也要记分。

结果不合法会整次拒绝，挂起状态保留，改对可以再回传一次：

| 错误码 | 什么时候 |
|---|---|
| `minigame-resolve-invalid` | 当前不在小游戏等待中：`resolveMinigame 仅在小游戏等待中有效（当前 __waiting=dialog）` |
| `minigame-result-invalid` | `outcome` 不是 `success`/`fail`，`score` 不是有限数字，`state` 不是对象 |
| `minigame-state-corrupt` | 等待态在但没有挂起记录 |

`state` 里有一个键写不进去，整批都不写。

## 什么时候会被打断

玩家回溯、读档、导航到别的列、或者引擎销毁时，`signal.aborted` 置位。这时小游戏要立刻收尾，**不要**回传结果——引擎不会接收。

回溯到小游戏那一屏时，引擎重新挂载：新的 `seq`、新的 `signal`。所以工厂每次挂载都要重新建状态，不能假设「上次那局还在」。

小游戏占的那一层是 `minigame`，在对话框和选项之上。

## 玩法系统接管

`interaction` 和小游戏是同一套机制，区别是它带一个 `system` 标识，可以挂多个不同的外部系统：

```json
{
  "op": "interaction",
  "system": "battle",
  "config": { "enemy": "slime" },
  "on_success": "battle_win",
  "on_fail": "battle_lose",
  "z": 1200
}
```

`system` 的写法和 `game` 一样（小写字母开头，最长 32 字符），不合法报「interaction.system 必填且为合法系统标识（匹配 /^[a-z][a-z0-9_-]{0,31}$/）」。

`interaction` **没有文本写法**——`minigame` 能用一行文本写，它不行。故事文件里用 JSON 形态写这条命令。

回传：

```ts
engine.resolveInteraction("battle", { outcome: "success", state: { hp: 30 } });
```

第一个参数是系统标识，跟发起时对不上会报「resolveInteraction 的系统标识不符：期望 battle，收到 fishing」。其他错误码跟小游戏一一对应（`interaction-resolve-invalid`、`interaction-result-invalid`、`interaction-state-corrupt`）。

`config` 不是对象时报「interaction.config 必须为对象（原样透传宿主）」。

## 玩法状态怎么写

宿主在玩法系统里改状态走 `engine.gameState`：

```ts
engine.gameState.set("hp", 30);              // 进事件流，界面能响应
engine.gameState.setSilent("cursorX", 120);  // 不进事件流
engine.gameState.setScoped("battle", "hp", 30);  // 落 game.battle.hp
engine.gameState.setScopedSilent("battle", "cursorX", 120);
```

`set` 和 `setSilent` 的区别在事件流：`set` 会发状态变更事件，界面能立刻响应；`setSilent` 不发。每帧都在变的坐标、鼠标位置用 `setSilent`——否则一秒钟几十条事件，界面会被淹没。拾到道具、任务完成这种低频变化用 `set`。

`setScoped` 自动加 `game.<系统>.` 前缀，不用自己拼。

这些键跟故事变量在同一个状态容器里，所以它们跟着存档、快照、回溯一起走。玩法系统不需要自己写存档逻辑。

写不进去的值（函数、`Map`、循环引用）会被拒绝，状态保持原样。

## 一个完整例子

```text
label fishing_spot:
  say "水面上有动静。"
  minigame "fishing" on_success "caught" on_fail "missed" config {difficulty: 2} reward {fish: 1}

label caught:
  say "钓上来了！"
  jump fishing_spot

label missed:
  say "鱼跑了。"
  jump fishing_spot
```

```ts
minigames.register("fishing", async (host, ctx) => {
  const difficulty = Number(ctx.config.difficulty ?? 1);
  const won = await runFishingMinigame(host, difficulty, ctx.signal);
  if (ctx.signal.aborted) return { outcome: "fail" };  // 被回溯打断，结果不会被接收
  return { outcome: won ? "success" : "fail", state: { attempts: 1 } };
});
```

## 下一步

- [回溯与历史](/concepts/rollback/)：回溯为什么会让小游戏重新挂载。
- [存档系统](/concepts/saves/)：玩法状态怎么跟着存档走。
- [扩展引擎](/concepts/extensions/)：给小游戏加自定义命令。
