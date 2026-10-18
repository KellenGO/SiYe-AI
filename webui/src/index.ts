import styles from "./styles.css?inline";

export { default as Panel } from "./Panel";
export { ResearchSettings as Settings } from "./Settings";
export const apiVersion = 1;

// 面板自带样式，跟随扩展一起加载，不依赖主程序样式表。
const KEY = "siye-research-styles";
if (typeof document !== "undefined" && !document.getElementById(KEY)) {
  const element = document.createElement("style");
  element.id = KEY;
  element.textContent = styles;
  document.head.append(element);
}
