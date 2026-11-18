/**
 * 故事侧的宿主出口（唯一出口）：默认故事清单与故事守卫。
 *
 * 清单由构建期扫描资源根得出（`virtual:story-list`），**不是手写声明**：漏抄一份故事
 * 文件在构建期毫无察觉，要到运行期才以 `unknown-column` 现形。TS 创作链编译出的
 * `.json` 与手写 `.story` 同树共存，共用这一条扫描。
 */
export { guards } from "./guards";
export { STORIES } from "virtual:story-list";
// 语言清单同源同理：构建期扫描资源根 Lang/（`virtual:lang-list`），浏览器形态的
// I18N 供给（createFetchI18nPort）由此装配，不手抄语言与文件表。
export { LANGS } from "virtual:lang-list";
