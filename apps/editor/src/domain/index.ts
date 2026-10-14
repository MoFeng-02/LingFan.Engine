/**
 * 领域层：编辑器的纯模型与判据（零框架、零 DOM、零 I/O）。
 *
 * 装的是「编辑器怎么想」的那部分：多文档会话、对话框状态机、资源树与搜索的
 * 分组规则、视图状态判定、拖拽阈值与对齐吸附等。这类判据最容易在界面代码里
 * 悄悄错掉（一个比较写反就整类资源消失），集中在此才可单测。
 *
 * 依赖方向：可用 `contracts` 与 `shared`；不得依赖 `ui` / `app` / `infra`。
 */
export * from "./addColumnIntent";
export * from "./columnWrite";
export * from "./dialog";
export * from "./dispatch";
export * from "./nodeGraphModel";
export * from "./pointerIntent";
export * from "./resourceTree";
export * from "./search";
export * from "./snapGuides";
export * from "./viewState";
export * from "./workspace";
