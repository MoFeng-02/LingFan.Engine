/** 构建失败（fail-closed）。消息即 CLI 打印的失败原因，逐字稳定——不要在别处重写措辞 */
export class StoryBuildError extends Error {}
