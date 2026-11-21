// encrypt-publish.mjs 导出面的类型声明（tests 直测用；文件编排主流程不进类型面）

/** 命令行解析结果（目录参数 + 开关）。 */
export interface EncryptPublishOptions {
  input: string;
  output: string;
  dist: string;
  androidAssets: string;
  allowPlaintext: boolean;
  skipBuild: boolean;
  dryRun: boolean;
}

/** 管线一步：command 为 null 表示强制末环「产物校验」（不走外部命令）。 */
export interface PublishStep {
  label: string;
  command: string | null;
  args: string[];
}

/** 产物校验结果：problems 非空即拒；allowPlaintext 时明文类问题降级为 warnings。 */
export interface VerifyResult {
  ok: boolean;
  problems: string[];
  warnings: string[];
}

/** Android assets 校验：未生成则 skipped=true 跳过。 */
export interface AndroidVerifyResult extends VerifyResult {
  skipped: boolean;
}

export interface VerifyOptions {
  allowPlaintext?: boolean;
}

/** 可注入的执行依赖（测试用记录器替身；缺省 execFileSync 真跑）。 */
export interface RunDeps {
  log?: (message: string) => void;
  exec?: (command: string, args: string[]) => void;
}

export const SEED_FILE: string;
export const SEED_BYTES: number;
export const MANIFEST_FILE: string;

export function parseArgs(argv: string[]): EncryptPublishOptions;
export function planSteps(options: EncryptPublishOptions): PublishStep[];
export function verifyPackOutput(
  outputDir: string,
  options?: VerifyOptions,
): VerifyResult;
export function verifyAndroidAssets(
  assetsDir: string,
  options?: VerifyOptions,
): AndroidVerifyResult;
export function runEncryptPublish(argv: string[], deps?: RunDeps): number;
