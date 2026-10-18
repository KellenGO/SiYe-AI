import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import axios from "axios";
import Panel from "../src/Panel";
import "./legacy-host.css";
import "../src/styles.css";
import { installMockAdapter } from "./mockAdapter";
import type { NoteBridge, WorkspaceSplitLayout } from "../src/contract";
import { zh } from "./zh";

const params = new URLSearchParams(location.search);
// file:// 下查询串不总被浏览器接受，预览开关也接受 #dark／#stream／#running／#empty。
const hash = location.hash.toLowerCase();
document.documentElement.dataset.theme = params.get("theme") === "dark" || hash.includes("dark") ? "dark" : "light";
if (location.protocol === "file:") installMockAdapter(axios);
if (params.get("empty") === "1") axios.defaults.headers.common["x-mock-empty"] = "1";
if (params.get("running") === "1") axios.defaults.headers.common["x-mock-running"] = "1";
if (params.get("stream") === "1") axios.defaults.headers.common["x-mock-streaming"] = "1";
try {
  localStorage.setItem("siye-research-width", params.get("w") ?? "660");
} catch { /* 预览台忽略存储异常 */ }

void i18n.use(initReactI18next).init({
  lng: "zh",
  fallbackLng: "zh",
  resources: { zh: { translation: zh } },
  interpolation: { escapeValue: false },
  parseMissingKeyHandler: (key) => key.split(".").pop() ?? key,
});

const note: NoteBridge = {
  conflict: false,
  hasResearch: () => false,
  hasSavedResearch: () => false,
  append: async () => undefined,
};

const split: WorkspaceSplitLayout = {
  active: false,
  noteWidth: 0,
  historyOpen: false,
  enter: () => undefined,
  restore: () => undefined,
  resize: () => undefined,
  setHistoryOpen: () => undefined,
};

function Shell() {
  const [open, setOpen] = React.useState(true);
  return <>
    <article className="dev-note">
      <header className="dev-note-meta">学习 / 旅行 / 苏州</header>
      <h1>苏州旅游攻略</h1>
      <p className="dev-note-quiet">2026 / 10 / 18 · 从 4 条收藏整理</p>
      <p>本地收藏里攒了 4 条苏州的攻略和避坑视频，一直没有整理。这次让 AI 读完正文、评论和字幕，输出一份能直接用的清单。</p>
      <h2>待办</h2>
      <ul>
        <li>订 11 月中旬的票，避开周末</li>
        <li>园林只挑拙政园和留园</li>
        <li>把限行时间和地铁站补上</li>
      </ul>
      <p className="dev-note-quiet">右侧是 AI 助手面板，宽度可以拖拽。</p>
    </article>
    <Panel spaceId={1} spaceName="苏州旅游攻略" sourceCount={4} note={note} archived={false}
      open={open} onClose={() => setOpen(false)} split={split} />
    {!open && <button type="button" className="dev-reopen" onClick={() => setOpen(true)}>打开 AI 助手</button>}
  </>;
}

const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={query}>
      <Shell />
    </QueryClientProvider>
  </React.StrictMode>,
);
