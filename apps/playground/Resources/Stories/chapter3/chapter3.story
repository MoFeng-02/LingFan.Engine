{
  "formatVersion": 1,
  "columns": [
    {
      "id": "ts_power",
      "kind": "flow",
      "commands": [
        {
          "op": "say",
          "text": "这一列由 TS 构建期条件生成——下面的清单就是本源文件用到的能力：",
          "speaker": "灵泛"
        },
        {
          "op": "say",
          "text": "1. interface / enum / as const —— 类型即文档"
        },
        {
          "op": "say",
          "text": "2. 函数注入 —— helpers 与词汇层构建器（词汇表单点）"
        },
        {
          "op": "say",
          "text": "3. for / while / do-while —— 重复结构构建期展开成静态数据"
        },
        {
          "op": "say",
          "text": "4. 递归 / 泛型 —— 容器元素树与重复生成器"
        },
        {
          "op": "say",
          "text": "5. 构建期条件 —— 本列由 PLACES 清单条件生成"
        },
        {
          "op": "say",
          "text": "6. 模板字符串 —— 文案可插构建期常量"
        },
        {
          "op": "say",
          "text": "7. 运行期语义仍由引擎 op 承载（whenChain/whileDo/random 显式种子）⇒ 回溯 / 存档全兼容"
        },
        {
          "op": "assert",
          "cond": "{player.gold >= 0}",
          "message": "金币不能为负"
        },
        {
          "op": "say",
          "text": "源文件在 Stories.src/——改完跑 stories:build（或开 watch），再重进本工程可见。"
        },
        {
          "op": "jump",
          "target": "end"
        }
      ]
    },
    {
      "id": "end",
      "kind": "flow",
      "commands": [
        {
          "op": "say",
          "text": "本列播完——列尾之后点击不再推进。",
          "speaker": "灵泛"
        },
        {
          "op": "say",
          "text": "（这条结局列也是 TS 源的一员：所有 jump/menu 的目标都在同一份类型安全的数据里。）"
        }
      ]
    }
  ]
}
