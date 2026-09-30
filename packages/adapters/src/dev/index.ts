/** 开发期适配器域出口（模块单一公共入口）：WS dev 通道（仅 DEV 浏览器形态使用） */
export {
  connectWsBridge,
  createWsProjectFilesPort,
  createWsSavePort,
  createWsHostPlatform,
  DEFAULT_WS_BRIDGE_URL,
  type WsBridge,
  type WsSocketLike,
  type ConnectWsBridgeOptions,
} from "./wsBridge";
