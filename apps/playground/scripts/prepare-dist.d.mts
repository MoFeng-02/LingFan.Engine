// prepare-dist.mjs 纯函数的类型声明（tests 直测用；文件编排主流程不进类型面）
export function resolveProtocolBase(
  platform: string,
  env: Record<string, string | undefined>,
): string;
export function rewriteHtml(
  html: string,
  base: string,
): { html: string; assets: string[] };
