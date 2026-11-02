/**
 * 审计脚本共用：浏览器侧前置探测（puppeteer-core、Chrome、preview 地址）。
 *
 * 四个站点审计脚本（audit-ia / audit-frontmatter / audit-i18n / audit-redline）
 * 的浏览器项都要先找到 puppeteer-core，再确认本机 Chrome/Edge 与 preview 可达。
 * 探测口径只在这里声明一次，各脚本只消费结果，避免同一判据在不同脚本里漂移。
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

export const LF_AUDIT_HOME =
  process.env.LF_AUDIT_HOME ?? "E:/Temp/Windows/lf-audit";
export const PREVIEW =
  process.env.LF_PREVIEW ?? "http://127.0.0.1:4322/LingFan.Engine";
export const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

/**
 * 探测 puppeteer-core，返回 createRequire 可用的**锚文件**（该包自己的
 * package.json）或降级原因。
 *
 * 锚点必须是实际存在的文件：`createRequire` 用它的路径做解析基准，锚文件不存在
 * 时探测必然判空。该包常装在仓外的审计工作区里，工作区本身可以没有根 package.json
 * （只有 node_modules），所以不能拿 `<home>/package.json` 当锚。
 *
 * base 从「假想工程根」换成「包自身 package.json」后，语义由「从该目录起解析」
 * 变成「以该文件所在目录起解析」——两者都指向 `<home>/node_modules`，解析结果
 * 相同，不是笔误，不要改回去。
 *
 * 失败原因分三种报（未安装 / 依赖树不完整 / preview 未响应）：前两种要补审计
 * 工作区的依赖，第三种只需起 preview——混成一句会把排查引向错误的环节。
 */
export const probePuppeteer = () => {
  const manifest = join(
    LF_AUDIT_HOME,
    "node_modules",
    "puppeteer-core",
    "package.json",
  );
  if (!existsSync(manifest)) {
    return {
      anchor: undefined,
      reason: `未安装 puppeteer-core：${manifest} 不存在（执行 cd ${LF_AUDIT_HOME} && npm install puppeteer-core 安装）`,
    };
  }
  try {
    createRequire(manifest).resolve("puppeteer-core");
    return { anchor: manifest, reason: "" };
  } catch (err) {
    return {
      anchor: undefined,
      reason: `puppeteer-core 已安装但依赖树不完整：以 ${manifest} 为锚无法解析到包入口（${err.code ?? err.message}；在 ${LF_AUDIT_HOME} 重装依赖）`,
    };
  }
};
