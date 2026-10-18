import type { AxiosAdapter, AxiosInstance } from "axios";
import { config, conversations, historyJob, latestJob, runningJob, streamingJob } from "./fixtures";

/** 静态预览时替换 axios 适配器，不启动服务器也能渲染真实数据形状。 */
export function installMockAdapter(client: AxiosInstance) {
  client.defaults.adapter = (async (request) => {
    const search = new URLSearchParams(location.search);
    const mode = search.get("empty") === "1" ? "empty"
      : search.get("stream") === "1" ? "stream"
      : search.get("running") === "1" ? "running" : "ready";
    const job = mode === "stream" ? streamingJob : mode === "running" ? runningJob : latestJob;
    const url = request.url ?? "";
    let data: unknown = null;
    if (url.endsWith("/config")) data = config;
    else if (url.endsWith("/preference")) data = { web_enabled: false };
    else if (url.endsWith("/conversations")) data = mode === "empty" ? [] : conversations;
    else if (url.endsWith("/latest")) data = mode === "empty" ? null : job;
    else if (url.includes("/conversations/")) data = mode === "empty" ? [] : [job];
    else if (url.includes("/jobs/")) data = job;
    else if (url.endsWith("/connection-test")) data = { connection_ok: true, web_ok: false };
    return { data, status: 200, statusText: "OK", headers: {}, config: request, request };
  }) as AxiosAdapter;
}
