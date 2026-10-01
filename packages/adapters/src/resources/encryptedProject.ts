/**
 * 加密工程（lfenpack 产物）形态识别与无壳形态拒绝文案。
 *
 * 为什么单独成模块：**这是唯一的「加密形态」判定点**。当前只有编辑器供给层一个消费者
 * （无解密密钥 ⇒ 显式 fail-closed）；将来编辑器桌面壳落地时，同一个判定点改为
 * 「有壳 → 走宿主解密供给 / 无壳 → 拒绝」，判定规则本身不必再写第二遍。
 *
 * ## 判定规则：**故事文件为密文**才算「打开不了」
 *
 * 故事是组装 Story 的**必需输入**（`Stories/**` 一个都读不出来就没故事可编），
 * 而 lfenpack 产物必然加密故事 ⇒ 以此为准既覆盖真实加密包、又不误伤可打开的根。
 *
 * **资源与 overlay 的密文不作为拒绝理由**（有意，与既有设计一致，不是「装作能读」）：
 * - 资源密文（`Audio/x.mp3.enc`）：磁盘上没有明文 `Audio/x.mp3` ⇒ 诊断**诚实报缺失**
 *   （`missing-resource`），预览不显示——不剥后缀、不读头，不制造「编辑器说在、运行期说缺」的分叉；
 * - overlay 密文（`Lang/…/x.json.enc`）：供给读回密文 → JSON 解析失败 → **宽容跳过**
 *   （少报不误报）；有解密能力的供给（桌面壳形态 `text()` 经 Rust 返回明文）照常入集，
 *   参与门槛只此一道，无任何后缀特判。
 *
 * 清单 `project.json` 恒明文（工程元数据），不参与判定。
 * 文件后缀常量只有本模块一份；其它模块要判断形态请复用本模块的函数。
 */

/** 加密工程识别结果 */
export interface EncryptedProjectFinding {
  /** **拒绝依据**：是否存在故事密文（读不到故事 = 无法打开，无可编辑内容） */
  encrypted: boolean;
  /** 故事密文路径（拒绝证据，升序） */
  encryptedStories: string[];
  /** 全部 `.enc` 路径（信息性证据：含资源与 overlay 密文，升序；提示里展示） */
  evidence: string[];
  /** `.enc` 文件总数 */
  count: number;
}

/** 加密包内文件的后缀（`Stories/x.json.enc` / `Audio/x.mp3.enc` / `Lang/…/x.json.enc`） */
const ENC_SUFFIX = ".enc";

/** 故事目录前缀（与引擎 `STORIES_DIR` 同口径；此处不引引擎以免循环依赖） */
const STORIES_PREFIX = "Stories/";

/** 判定加密工程形态（纯函数；`paths` = 资源根内全枚举逻辑路径） */
export function detectEncryptedProject(
  paths: readonly string[],
): EncryptedProjectFinding {
  const evidence = paths
    .filter((path) => typeof path === "string" && path.endsWith(ENC_SUFFIX))
    .slice()
    .sort();
  const encryptedStories = evidence.filter((path) =>
    path.startsWith(STORIES_PREFIX),
  );
  return {
    encrypted: encryptedStories.length > 0,
    encryptedStories,
    evidence,
    count: evidence.length,
  };
}

/**
 * 无壳形态的**可操作**拒绝文案：说清「是什么 / 为什么读不了 / 现在怎么办」。
 * 桌面壳批次落地后，本函数仅用于无壳形态（有壳走解密供给，不再抛）。
 */
export function encryptedProjectMessage(
  root: string,
  finding: EncryptedProjectFinding,
): string {
  const sample = finding.encryptedStories.slice(0, 3).join("、");
  const more =
    finding.encryptedStories.length > 3 ? " 等" : "";
  const others = finding.count - finding.encryptedStories.length;
  const tail = others > 0 ? `（资源/译文另有 ${others} 个密文文件）` : "";
  return [
    `资源根（${root}）是加密工程（lfenpack 产物）：`,
    `故事为密文，已发现 ${sample}${more}。${tail}`,
    "浏览器形态没有解密密钥（密钥与格式知识在 Rust 层，浏览器侧不猜），因此无法打开；",
    "请改选**明文工程**目录；加密工程需桌面壳形态复用宿主解密供给。",
  ].join("");
}