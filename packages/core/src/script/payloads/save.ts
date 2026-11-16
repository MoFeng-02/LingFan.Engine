/**
 * 存档域 op 负载：save / load / auto_save / save_delete。
 *
 * 负载用 type 别名而非 interface：TS 只给对象字面量类型隐式索引签名，
 * CommandOf 产物要能赋给 StoryCommand（开放索引签名），负载必须是
 * 字面量类型形态。slot 的短 id 正则（SlotName）在校验器侧。
 */

/** save：写入存档槽，title 缺省由宿主生成 */
export type SaveOpPayload = {
  slot: string;
  title?: string;
};

/** load：读取存档槽 */
export type LoadOpPayload = {
  slot: string;
};

/** auto_save：开关自动存档 */
export type AutoSaveOpPayload = {
  enabled: boolean;
};

/** save_delete：删除存档槽 */
export type SaveDeleteOpPayload = {
  slot: string;
};

/** 存档域 op → 负载登记（域 map 住域文件，总登记只 extends） */
export interface SavePayloadMap {
  save: SaveOpPayload;
  load: LoadOpPayload;
  auto_save: AutoSaveOpPayload;
  save_delete: SaveDeleteOpPayload;
}
