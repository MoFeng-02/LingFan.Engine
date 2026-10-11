---
title: 状态与变量
description: 用 set、let、local 写变量，用 array、dict 存集合，用 {expr} 把值插进文本。全局变量跟着存档和回溯一起走，块级变量不会。
---

故事里的变量分两种落点：**全局层**和**当前作用域**。分清楚这一点，存档和回溯的行为就不会意外。

## 写一个变量

```text
label title_main:
  set "player.name" "阿岚"
  say "你好，{player.name}。"
```

`set` 会先沿着当前作用域链找同名变量，找到就写那一层；找不到就写进全局层。所以第一次 `set` 写的是全局变量。

`let` 和 `local` 不一样，它们总是声明进最内层作用域：

```text
label title_main:
  if {has_key}
    let "hint" "钥匙在你手里"
    say "{hint}"
  say "{hint}"
```

块体靠缩进划分，没有 `endif` 这种收尾关键字。`hint` 声明在 `if` 块里，出块就没了；最后那句 `say` 插值时找不到 `hint`，引擎把 `unknown-variable` 错误发到 `engine.error`，正文按原文（`{hint}`）照显，故事照常等玩家点击——不静默吞掉，也不会让工程停摆。

块级和列级变量不进存档，也不参与回溯——它们随执行帧销毁。全局变量跟着快照、存档、回溯一起走。

## 改一个已有的值

```text
  set "coins" 10
  set "coins" += 5
```

`+=` `-=` `*=` `/=` `%=` 都支持，只对数字有效。除零和模零直接报 `division-by-zero`，不会给你 `Infinity`。

## 常量

`define` 只在变量不存在时赋值，适合写配置：

```text
define "max_hp" 100
set "max_hp" 200
say "{max_hp}"
```

第二句是普通 `set`，会真的改掉它。`define` 只保证「第一次是谁写的」。

`undef` 删掉一个变量。作用域链和全局层都找不到它，会报 `undef：未定义变量 X` 并停机——删之前先确认它存在。

## 集合

```text
  array "inventory" ["钥匙", "信"]
  array_push "inventory" "地图"
  array_pop "inventory"

  dict "player" { "name": "阿岚", "hp": 100 }
  dict_set "player" "hp" 80
```

`array_push` 要求目标已经存在且是数组；`array_pop` 在数组为空时报错，不会给你 `undefined`。`dict_set` 要求目标是字典，数组不算。

这几条命令都写入新的数组/字典引用，不是原地改——渲染层才能感知到值变了。

`random` 从闭区间里抽一个整数：

```text
  random seed=20261010 min=1 max=6 var="dice"
  say "掷出了 {dice}。"
```

种子进状态，所以同一份故事回溯重放时，抽到的还是同一串数字。`seed` 必须是整数，`min` 不能大于 `max`。

## 表达式

条件、插值、变量值里都能写表达式：

```text
  if {coins >= 10 && has_key}
    say "可以开门了。"
```

支持 `== != >= <= > < && || + - * / %`、一元 `!` `-`、三元 `? :` 和括号。`>=` `<=` `>` `<` 只吃数字；`==` `!=` 只吃同类型标量（数字、字符串、布尔），跨类型报 `type-error`；`&&` `||` `!` 只吃布尔值——传错类型都会报 `type-error`，不会静默算出 `NaN`。

内建函数只有五个：`random(lo, hi)`（含端点，参数必须是整数）、`min(a, b)`、`max(a, b)`、`abs(a)`、`clamp(v, lo, hi)`。写别的名字会报 `未知函数：X（可用：random/min/max/abs/clamp）`。

表达式出错会停机并把错误发到 `engine.error` 事件，不是静默取默认值。

## 把值插进文本

```text
  set "minutes" 7
  say "还剩 {minutes:00} 分钟。"
```

`{minutes:00}` 渲染成 `07`。格式符只对整数生效：全 `0` 按位数补零，`X` 输出大写十六进制，`x` 输出小写，其他格式符原样输出。

文本里还有一套行内标记，和插值共用大括号：

```text
  say "这是 {b}加粗{/b}，这是 {color=#7aa2f7}蓝色{/color}。"
  say "等一拍{p}再说话。"
```

`b` `/b` `i` `/i` `u` `/u` 是样式，`color=` `font=` `size=` 带参数，`{p}` 停顿、`{w}` 等待、`{fast}` 快进。这些标记原样传给渲染层，不参与求值。

但 `{i}` 有歧义：如果你有个变量叫 `i`，它按变量求值；没有这个变量，它当行内标记透传。用别的变量名更省事。

插值出错时原文片段保留，错误收集起来，不会中断渲染。

## 保留键

`__` 开头的键是引擎自己用的，比如 `__current_dialog_text`、`__waiting`。程序化写这些键会被拒绝（`reserved-key`）。你自己定义 `__foo` 这样的键不受影响——判定按精确键名。

## 观察状态变化

宿主通过 `engine.onStateChanged` 拿到每次写入：

```ts
engine.onStateChanged((change) => {
  console.log(change.key, change.value, change.scope);
});
```

`scope` 是 `"global"`、`"column"` 或 `"block"`，告诉你这次写入落在哪一层。

## 下一步

- [回溯与历史](/concepts/rollback/)：变量怎么跟着回溯回退。
- [存档系统](/concepts/saves/)：哪些状态进存档，哪些不进。
- [扩展引擎](/concepts/extensions/)：扩展怎么读写状态。
