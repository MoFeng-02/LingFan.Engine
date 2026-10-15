---
title: 扩展引擎
description: 自定义 op 以 ESM 模块形式声明，在 project.json 里登记后装载。扩展写状态自动进存档，未注册时按未知命令拒绝。
---

内建 66 个 op 覆盖叙事、表现、音频、存档这些常规需求。要加自己的命令——养成数值、卡牌逻辑、跟外部系统对接——用扩展。

扩展是一个 ESM 模块，默认导出一个描述对象：

```ts
// ext/affinity.ts
export default {
  id: "affinity",
  stateVersion: 1,
  ops: [
    {
      op: "affinity_add",
      exec(cmd, ctx) {
        const key = String(cmd.key ?? "");
        const delta = Number(cmd.delta ?? 0);
        if (key === "" || !Number.isFinite(delta)) {
          return {
            ok: false,
            code: "affinity-invalid",
            message: "affinity_add 需要 key 与 delta",
          };
        }
        const current = Number(ctx.get(`value.${key}`) ?? 0);
        ctx.set(`value.${key}`, current + delta);
        return { ok: true };
      },
    },
  ],
};
```

## 三个字段

| 字段           | 作用                                                        |
| -------------- | ----------------------------------------------------------- |
| `id`           | 稳定标识。小写字母开头，小写字母/数字/`_`/`-`，最长 32 字符 |
| `stateVersion` | 状态结构版本，正整数。跟代码版本不是一回事                  |
| `ops`          | 提供的自定义 op 列表，可选                                  |

`id` 会写进存档——存档记着「这份档用了哪些扩展、各是什么状态版本」。

`stateVersion` 管的是**状态形状**。你重构代码但状态里存的键没变，就不用动它；加了新键或者改了值的含义，才往上加。

`ops` 里每个定义：

| 字段             | 作用                                                          |
| ---------------- | ------------------------------------------------------------- |
| `op`             | 故事里写的命令名                                              |
| `exec(cmd, ctx)` | 执行体，返回 `{ ok: true }` 或 `{ ok: false, code, message }` |
| `project`        | 可选，文本写法的投影，见下                                    |
| `schema`         | 可选，给编辑器用的表单声明。引擎不解释                        |

## 登记与装载

扩展要写在 `Resources/project.json` 里才会被装载：

```json
{
  "formatVersion": 1,
  "id": "my-story",
  "entry": "title_main",
  "extensions": ["ext/affinity.ts", "ext/cards.ts"]
}
```

字符串是模块说明符，宿主用它动态 `import`：

```ts
import { loadDeclaredExtensions } from "@lingfan/engine";

const extensions = await loadDeclaredExtensions(
  manifest.extensions,
  (specifier) => import(specifier),
);
const engine = new StoryEngine(story, { savePort, extensions });
```

**没有登记的文件不会被扫到。** 你把 `ext/foo.ts` 放进工程但忘了写进 `extensions`，它对引擎完全不存在——不会装载，不会报错。这个设计是为了避免打包时把整个目录拖进来。

没写 `extensions` 字段，或者写成空数组，装载器一次都不会被调用。

装载失败会抛错，消息里带着是清单里哪一条出的问题：

```text
扩展装载失败：ext/affinity.ts —— 模块未提供默认导出（须为 OpExtension 声明）
扩展装载失败：ext/affinity.ts —— id 不合法：Affinity（须匹配 /^[a-z][a-z0-9_-]{0,31}$/）
扩展装载失败：ext/affinity.ts —— ops 条目须为 { op: 非空名, exec: 函数 }
```

## 注册期的检查

引擎构造时校验扩展，出问题直接抛错，故事跑不起来：

| 情况                      | 报什么                                                         |
| ------------------------- | -------------------------------------------------------------- |
| `id` 不合法               | `扩展 id 不合法：Affinity（须匹配 /^[a-z][a-z0-9_-]{0,31}$/）` |
| 同一个 `id` 注册两次      | `扩展 id 重复注册：affinity`                                   |
| `stateVersion` 不是正整数 | `扩展 affinity 的 stateVersion 不合法：0（须为正整数）`        |
| op 名跟内建撞了           | `扩展 affinity 的 op「say」与内建 op 冲突（内建不可覆盖）`     |
| op 名跟别的扩展撞了       | `扩展 affinity 的 op「draw」与其他扩展重复`                    |
| 没写 `exec`               | `扩展 affinity 的 op「draw」缺少 exec`                         |

内建永远赢。你想覆盖 `say` 的行为，改不了。

## 写状态

扩展的上下文只有三样东西：

```ts
interface ExtensionContext {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  readonly story: Readonly<Story>;
}
```

`set` 和 `get` 走的是**你自己那个命名空间**——引擎在物理上给你加了 `ext.<你的id>.` 前缀。上面例子里 `ctx.set("value.affinity", 10)` 实际写的是 `ext.affinity.value.affinity`。写不出前缀以外的键，这是结构上保证的。

好处是：写进去的值就是全局状态，跟着快照、存档、回溯一起走，序列化交给引擎。你不需要自己管存档。

`story` 是只读的。改故事只能经故事命令和编辑器。

写进去的值必须是 JSON 安全的。塞函数、`Map`、循环引用会被拒绝，报错后状态保持原样。

## 执行体不能抛

`exec` 返回 `{ ok: false, code, message }` 表示失败，引擎会发 `engine.error` 并停在当前命令，状态不变。

如果它抛异常，引擎兜住并转成 `custom-op-threw`。故事不会崩，但错误码不是你的了，排查起来更难。**自己判失败，别抛。**

```ts
exec(cmd, ctx) {
  if (typeof cmd.amount !== "number") {
    return { ok: false, code: "shop-invalid-amount", message: "shop_buy 需要数字 amount" };
  }
  // ...
  return { ok: true };
}
```

## 故事里怎么用

JSON 形态直接写：

```json
{ "op": "affinity_add", "key": "lin", "delta": 5 }
```

文本形态默认不行——解析器不认识 `affinity_add`，会报「文本投影暂不支持的语句：affinity_add」。想让它在 `.story` 里也能写，加一个投影器：

```ts
{
  op: "affinity_add",
  exec(cmd, ctx) { /* … */ },
  project: {
    toText: (cmd) => `affinity_add "${cmd.key}" ${cmd.delta}`,
    fromText: (text) => {
      const m = /^affinity_add\s+"([^"]*)"\s+(-?[\d.]+)$/.exec(text);
      if (m === null) return null;
      return { op: "affinity_add", key: m[1], delta: Number(m[2]) };
    },
  },
}
```

`toText` 返回 `null` 表示这条命令投影不出来，写回文本时会整次拒绝。`fromText` 返回 `null` 表示这行解析失败，报错会带行列号。两个方向都不该抛。

不写投影器也能用——扩展命令照常执行，只是故事文件得用 JSON 形态写。

## 扩展与存档

用过扩展的故事，存档里会多一段：

```json
{
  "extensions": [{ "id": "affinity", "stateVersion": 1 }]
}
```

读档时引擎逐个核对：

| 情况                                        | 结果                                                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 扩展没注册                                  | 整档拒绝：`存档依赖的扩展未注册：「affinity」。请安装并启用该扩展后再读档`                                 |
| 档的状态版本比扩展旧，扩展有 `migrate`      | 调用 `migrate` 迁移，成功后提示「扩展「affinity」状态已从 v1 迁移到 v2」                                   |
| 档的状态版本比扩展旧，`migrate` 返回 `null` | 整档拒绝：`扩展「affinity」无法从状态版本 v1 迁移到 v2，存档被拒绝`                                        |
| 档的状态版本比扩展旧，扩展没有 `migrate`    | 整档拒绝：`存档依赖扩展「affinity」的状态版本 v1，当前注册版本为 v2（存档过新或缺少迁移路径），存档被拒绝` |
| 档的状态版本比扩展新                        | 同上，拒绝                                                                                                 |
| 扩展的 `restore` 返回 `false`               | 整档拒绝：`扩展「affinity」读档恢复失败（restore 返回 false），存档被拒绝`                                 |

没用到扩展的存档不带这段，装了扩展的引擎照样能读——不会误判。

### 状态迁移

`migrate` 拿到的是你那个命名空间内的键值，**不带** `ext.<id>.` 前缀，返回同构对象：

```ts
{
  id: "affinity",
  stateVersion: 2,
  migrate(fromStateVersion, state) {
    if (fromStateVersion !== 1) return null;
    return { ...state, bonds: {} };  // v1 没有 bonds，补个空对象
  },
  ops: [ /* … */ ],
}
```

返回 `null` 表示迁不动，整档拒绝。这个函数也不该抛。

### 恢复运行期句柄

状态恢复之后，有些东西得重新接上——定时器、事件订阅、跟外部系统的连接。用 `restore`：

```ts
{
  id: "affinity",
  stateVersion: 1,
  restore(ctx) {
    const pending = ctx.get("pendingEvent");
    if (pending !== undefined) scheduleAffinityEvent(pending);
    return true;
  },
  ops: [ /* … */ ],
}
```

返回 `false` 表示恢复不了，整档拒绝。状态保持原样。

## 扩展能做什么，不能做什么

能：

- 加新 op，写自己的命名空间状态。
- 提供文本投影，让自定义命令能写进 `.story`。
- 声明状态版本，提供迁移和恢复。

不能：

- 覆盖或删除内建 op。
- 写自己命名空间以外的状态键。
- 改故事定义（`story` 只读）。
- 碰文件系统、密钥、平台接口——上下文里根本没有这些东西。需要平台能力就让宿主去做，扩展通过状态跟宿主通信。

## 下一步

- [存档系统](/concepts/saves/)：扩展标记怎么进存档。
- [状态与变量](/concepts/state/)：`ext.` 命名空间在状态容器里的位置。
- [小游戏与玩法系统](/concepts/minigame/)：玩法状态的另一种写法。
