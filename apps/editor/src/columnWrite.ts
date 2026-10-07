/**
 * 单文档写回的**期望集组装**（多文档面防丢数据的另一半）。
 *
 * 背景：`ProjectWriterPort.apply(files)` 接受的是**整工程期望集**（缺什么就删什么），
 * 而多文档面手上只有「一个文档的序列化产物」。若直接把单列产物喂给 writer，
 * `diffProjectFiles` 会把**未编辑的其他列文件**判为陈旧并删除
 * （`DELETES = ["Stories/start.json"]`，见 `serializeColumnDocument` 的回归测试）。
 *
 * 本模块的职责：**打开基线 + 本次改动→ 一个语义完整的期望集**。
 * 约束：
 * ① **不发明命名规则**——目标路径由引擎给的产物决定（`serializeColumnDocument` 产出）。
 * ② **清单托管键不在此改**：单文档不知道工程级 `entry`/`defines`（`assembleProject`
 * 把文件级 defines 上移清单级，单列独立解析拿不到）⇒ 清单沿用基线原文本，一个字节不碰。
 * ③ **删除只走显式意图**：文档被删列/改名时调用方显式声明，本模块不猜测。
 * ④ **fail-closed**：改动与声明矛盾时拒绝组装，不产出半套期望集。
 */

/** 一次单文档写回请求：目标产物 + 显式声明的删除集 */
export interface ColumnWriteRequest {
  /** 该文档当前状态的完整文件集（`serializeColumnDocument` 的产物，键 = 逻辑路径） */
  readonly files: ReadonlyMap<string, string>;
  /**
   * 显式删除的路径（列被删 / 改名后的旧文件）。**默认为空**——
   * 「不在产物里就删」不是本模块的默认行为（那正是缺陷本体）。
   */
  readonly deletes?: readonly string[];
}

/**
 * 组装整工程期望集：`基线 ∪ 本次产物 − 显式删除`，键按码元序。
 *
 * 纯函数（同 `serializeProject` 的确定性约束：期望文件集必须与构造顺序无关）。
 */
export function assembleColumnWrite(
  baseline: ReadonlyMap<string, string>,
  request: ColumnWriteRequest,
): Map<string, string> {
  const deletes = new Set(request.deletes ?? []);
  // 显式删除的路径必须真在基线里——删一个不存在的文件是调用方的判断错误，不是静默容错的地方
  for (const path of deletes) {
    if (!baseline.has(path)) {
      throw new Error(`声明删除的路径不在打开基线内：${path}`);
    }
  }
  const out = new Map<string, string>();
  for (const [path, text] of baseline) {
    if (deletes.has(path)) continue;
    out.set(path, text);
  }
  for (const [path, text] of request.files) {
    if (deletes.has(path)) {
      throw new Error(`同一次写回既要写入又要删除：${path}`);
    }
    out.set(path, text);
  }
  return new Map([...out.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}
