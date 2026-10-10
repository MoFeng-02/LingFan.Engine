/**
 * 舞台外壳出口（唯一出口）：截图与媒体采集——存档缩略图（合成卡 + 真像素分层合成）、
 * HTML 摘要。这些函数都直接碰 `document` / `canvas`，只服务于本宿主的存档呈现，
 * 不对外复用。实现按「合成卡基座 / 舞台真像素分层」分两文件，名字面在此收拢。
 */
export {
  captureSaveThumbnail,
  stripHtml,
  type SaveThumbnailInput,
} from "./thumbnail";
export {
  captureStageComposite,
  collectStageMedia,
  type StageCompositeInput,
  type StageMediaLayer,
} from "./save-composite";
