/**
 * 舞台外壳出口（唯一出口）：截图与媒体采集——存档缩略图、舞台合成、HTML 摘要。
 * 这些函数都直接碰 `document` / `canvas`，只服务于本宿主的存档呈现，不对外复用。
 */
export {
  captureSaveThumbnail,
  captureStageComposite,
  collectStageMedia,
  stripHtml,
  type SaveThumbnailInput,
  type StageCompositeInput,
  type StageMediaLayer,
} from "./thumbnail";
