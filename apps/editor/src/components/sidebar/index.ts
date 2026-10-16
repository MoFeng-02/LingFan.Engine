/**
 * 侧栏族：工程浏览与多文档标签。
 *
 * 「资源树 / 章节树」是左栏的两棵树，`DocTabs` 是已打开文档的标签行；
 * 三者只吃 props 与注入端口，不自己取数；左栏的排布在 `../panes/SidebarPane.vue`。
 */
export { default as ResourceTreeView } from "./ResourceTreeView.vue";
export { default as ChapterTree } from "./ChapterTree.vue";
export { default as DocTabs } from "./DocTabs.vue";
