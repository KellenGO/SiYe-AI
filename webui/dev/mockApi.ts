import type { Plugin } from "vite";
import { config, conversations, historyJob, latestJob, runningJob, streamingJob } from "./fixtures";

function json(res: import("node:http").ServerResponse, value: unknown, status = 200) {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(body);
}

export function mockApi(): Plugin {
  return {
    name: "siye-mock-api",
    configureServer(server) {
      server.middlewares.use("/api/research", (req, res) => {
        const url = (req.url ?? "").split("?")[0];
        const method = req.method ?? "GET";
        const empty = req.headers["x-mock-empty"] === "1";
        const running = req.headers["x-mock-running"] === "1";
        const streaming = req.headers["x-mock-streaming"] === "1";
        const live = streaming ? streamingJob : running ? runningJob : latestJob;
        if (method === "GET" && url === "/config") return json(res, config);
        if (method === "GET" && url === "/spaces/1/preference") return json(res, { web_enabled: false });
        if (method === "GET" && url === "/spaces/1/conversations") return json(res, empty ? [] : conversations);
        if (method === "GET" && url === "/spaces/1/latest") return json(res, empty ? null : live);
        if (method === "GET" && url.startsWith("/spaces/1/conversations/")) return json(res, empty ? [] : [live]);
        if (method === "GET" && url.startsWith("/jobs/")) return json(res, live);
        return json(res, { error: "mock 未实现" }, 404);
      });
    },
  };
}
