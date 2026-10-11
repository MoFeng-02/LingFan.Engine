{
  "formatVersion": 1,
  "id": "inn",
  "kind": "flow",
  "commands": [
    {
      "op": "func",
      "name": "farewell",
      "params": [
        "who"
      ],
      "body": [
        {
          "op": "say",
          "text": "{who}：慢走，路上小心。"
        }
      ]
    },
    {
      "op": "say",
      "text": "欢迎光临，{player.gold} 金币的贵客！",
      "speaker": "酒馆老板"
    },
    {
      "op": "call",
      "target": "farewell",
      "args": [
        "酒馆老板"
      ]
    },
    {
      "op": "jump",
      "target": "end"
    }
  ]
}
