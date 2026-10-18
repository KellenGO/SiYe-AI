import type { NoteDocument } from "../src/contract";
import type { ResearchConversation, ResearchConfig, ResearchJob } from "../src/researchApi";

type Source = "S1" | "S2" | "S3" | "S4";

function text(value: string): NoteDocument {
  return { type: "text", text: value };
}

function cite(ref: Source, section: "body" | "comments" | "subtitles"): NoteDocument {
  return {
    type: "text",
    text: `[${ref}:${section}]`,
    marks: [{ type: "link", attrs: { href: `#source-${ref}`, target: "_blank", rel: "noopener noreferrer" } }],
  };
}

function bold(value: string, ref?: [Source, "body" | "comments" | "subtitles"]): NoteDocument[] {
  return [{
    type: "text",
    text: value,
    marks: [{ type: "bold" }, ...(ref ? [{ type: "link", attrs: { href: `#source-${ref[0]}` } }] : [])],
  }];
}

function bullet(parts: NoteDocument[]): NoteDocument {
  return { type: "listItem", content: [{ type: "paragraph", content: parts }] };
}

function heading(level: number, value: string): NoteDocument {
  return { type: "heading", attrs: { level }, content: [text(value)] };
}

const answer: NoteDocument = {
  type: "doc",
  content: [
    heading(3, "先说结论"),
    { type: "paragraph", content: [
      text("这 4 条资料里，有两件事被反复提到："),
      ...bold("景区门口的“内部票”基本都是拉客"),
      text("，以及"),
      ...bold("古城内的短途交通不建议坐黄包车或游船"),
      text("。其余争论集中在大闸蟹和园林取舍上，我按“会不会真的花钱踩坑”排了序。"),
    ] },
    heading(3, "一、门票与票价"),
    { type: "bulletList", content: [
      bullet([
        ...bold("别信“内部人员低价门票”的兜售"),
        text("，老实走美团或景区门口买票；所谓丝绸博物馆、珍珠博物馆其实是商场，会拉你进房间推销"),
        cite("S3", "comments"),
        text("。"),
      ]),
      bullet([
        ...bold("学生证多数景区半价"),
        text("，研究生证能不能用要看具体景区，评论区在这点上说法不一致"),
        cite("S3", "comments"),
        text("。"),
      ]),
    ] },
    heading(3, "二、避坑建议"),
    { type: "bulletList", content: [
      bullet([
        text("有游客反映"),
        ...bold("古运河游船体验很差"),
        text("（5 分钟、周围在装修），“一日游”导游会反复劝购，需警惕"),
        cite("S3", "comments"),
        text("。"),
      ]),
      bullet([
        ...bold("护城河内的热门区域常有“黄包车”拉客"),
        text("，不建议坐；竹筒奶茶、园区内小吃普遍又贵又一般，可往巷子里走买更便宜的"),
        cite("S2", "body"),
        cite("S3", "comments"),
        text("。"),
      ]),
      bullet([
        text("写“苏式绿豆汤”“苏式火锅”的店不必尝试，“苏式火锅”并不存在；9 月底前基本吃不到真正的阳澄湖大闸蟹，蟹黄汤包慎点"),
        cite("S2", "body"),
        text("。"),
      ]),
      bullet([
        ...bold("自驾注意"),
        text("：拙政园一带早上 7:00—19:00 限行，可停在附近再步行过去"),
        cite("S3", "comments"),
        text("。"),
      ]),
    ] },
    heading(3, "三、时间与吃饭"),
    { type: "bulletList", content: [
      bullet([
        text("尽量避开节假日和周末，人多时园林完全没有意境；有人建议园林只挑 1—2 个看，个人更推荐拙政园 + 留园"),
        cite("S4", "subtitles"),
        cite("S4", "comments"),
        text("。"),
      ]),
      bullet([
        text("夜游可考虑网师园（昆曲评弹配古建水池）或沧浪亭昆曲专场"),
        cite("S4", "subtitles"),
        cite("S4", "comments"),
        text("。"),
      ]),
      bullet([
        ...bold("想吃苏帮菜"),
        text("可去李公堤一带的苏帮菜馆；想随便吃好吃的就去十全街，买碧螺春、茶叶可以去“三萬昌”，奶茶和桃酥口碑不错"),
        cite("S2", "body"),
        text("。"),
      ]),
    ] },
    { type: "paragraph", content: [
      text("不确定的地方：评论里有人说这些视频是几年前拍的，价格和限行时间可能已经变了，出发前建议再核一次官方公告。"),
      cite("S4", "comments"),
    ] },
  ],
};

export const config: ResearchConfig = {
  protocol: "openai",
  base_url: "https://api.deepseek.com",
  model: "deepseek-flash",
  has_key: true,
  key_mask: "sk-****3f2a",
  runtime: { sdk_available: false, cli_available: false, sdk_version: "", cli_version: "" },
};

const job: ResearchJob = {
  job_id: "job-demo-1",
  space_id: 1,
  web_enabled: false,
  question: "来给我总结一下去苏州旅游需要注意哪些点",
  conversation_id: "conv-demo-1",
  status: "ready",
  phase: "done",
  message: "",
  error: "",
  total_materials: 4,
  materials: [
    { key: "xhs|1", platform: "xhs", title: "苏州三天两夜｜避坑版行程", url: "https://www.xiaohongshu.com/explore/1",
      body: { state: "ok", count: 0, reason: "", truncated: false },
      comments: { state: "ok", count: 50, reason: "最多取得 50 条评论", truncated: true, sort: "按热度排序" },
      subtitles: { state: "not_applicable", count: 0, reason: "", truncated: false } },
    { key: "xhs|2", platform: "xhs", title: "苏州吃喝实录（含踩雷）", url: "https://www.xiaohongshu.com/explore/2",
      body: { state: "ok", count: 0, reason: "", truncated: false },
      comments: { state: "restricted", count: 0, reason: "平台限制评论", truncated: false },
      subtitles: { state: "not_applicable", count: 0, reason: "", truncated: false } },
    { key: "bilibili|3", platform: "bilibili", title: "苏州旅游到底有多坑？本地人说说", url: "https://www.bilibili.com/video/3",
      body: { state: "ok", count: 0, reason: "", truncated: false },
      comments: { state: "ok", count: 120, reason: "最多取得 120 条评论", truncated: false },
      subtitles: { state: "ok", count: 0, reason: "", truncated: false, metadata: { source: "native", duration: 742 } } },
    { key: "bilibili|4", platform: "bilibili", title: "苏州园林怎么选｜拙政园 vs 留园", url: "https://www.bilibili.com/video/4",
      body: { state: "ok", count: 0, reason: "", truncated: false },
      comments: { state: "ok", count: 64, reason: "", truncated: false },
      subtitles: { state: "ok", count: 0, reason: "", truncated: false, metadata: { source: "local_asr", duration: 1180 } } },
  ],
  document: answer,
  coverage: [
    { key: "xhs|1", title: "苏州三天两夜｜避坑版行程", chunks: 3, read_chunks: 3, complete: true, sections: {
      body: { chunks: 1, read_chunks: 1, read_indices: [0], complete: true, reading_complete: true, state: "ok", reason: "", truncated: false, count: 0 },
      comments: { chunks: 2, read_chunks: 2, read_indices: [0, 1], complete: true, reading_complete: true, state: "ok", reason: "", truncated: false, collection_truncated: true, count: 50 },
      subtitles: { chunks: 0, read_chunks: 0, read_indices: [], complete: false, reading_complete: false, state: "not_applicable", reason: "", truncated: false, count: 0 } } },
    { key: "xhs|2", title: "苏州吃喝实录（含踩雷）", chunks: 1, read_chunks: 1, complete: true, sections: {
      body: { chunks: 1, read_chunks: 1, read_indices: [0], complete: true, reading_complete: true, state: "ok", reason: "", truncated: false, count: 0 },
      comments: { chunks: 0, read_chunks: 0, read_indices: [], complete: false, reading_complete: false, state: "restricted", reason: "平台限制评论", truncated: false, count: 0 },
      subtitles: { chunks: 0, read_chunks: 0, read_indices: [], complete: false, reading_complete: false, state: "not_applicable", reason: "", truncated: false, count: 0 } } },
    { key: "bilibili|3", title: "苏州旅游到底有多坑？本地人说说", chunks: 3, read_chunks: 2, complete: false, sections: {
      body: { chunks: 1, read_chunks: 1, read_indices: [0], complete: true, reading_complete: true, state: "ok", reason: "", truncated: false, count: 0 },
      comments: { chunks: 1, read_chunks: 1, read_indices: [0], complete: true, reading_complete: true, state: "ok", reason: "", truncated: false, count: 120 },
      subtitles: { chunks: 1, read_chunks: 0, read_indices: [], complete: false, reading_complete: false, state: "ok", reason: "", truncated: false, count: 0, metadata: { source: "native", duration: 742 } } } },
    { key: "bilibili|4", title: "苏州园林怎么选｜拙政园 vs 留园", chunks: 2, read_chunks: 2, complete: true, sections: {
      body: { chunks: 1, read_chunks: 1, read_indices: [0], complete: true, reading_complete: true, state: "ok", reason: "", truncated: false, count: 0 },
      comments: { chunks: 1, read_chunks: 1, read_indices: [0], complete: true, reading_complete: true, state: "ok", reason: "", truncated: false, count: 64 },
      subtitles: { chunks: 1, read_chunks: 1, read_indices: [0], complete: true, reading_complete: true, state: "ok", reason: "", truncated: false, count: 0, metadata: { source: "local_asr", duration: 1180 } } } },
  ],
  activity: [
    { id: "step-1", tool: "mcp__research__manifest", message: "manifest", status: "completed", summary: "4 条空间资料，0 条外部来源" },
    { id: "step-2", tool: "mcp__research__read_material", message: "read_material", status: "completed", summary: "苏州三天两夜｜避坑版行程 · body 第 1 段 · 2841 字符" },
    { id: "step-3", tool: "mcp__research__read_material", message: "read_material", status: "completed", summary: "苏州三天两夜｜避坑版行程 · comments 第 1 段 · 1902 字符" },
    { id: "step-4", tool: "mcp__research__read_material", message: "read_material", status: "completed", summary: "苏州旅游到底有多坑？本地人说说 · comments 第 1 段 · 2210 字符" },
    { id: "step-5", tool: "mcp__research__read_material", message: "read_material", status: "completed", summary: "苏州园林怎么选｜拙政园 vs 留园 · subtitles 第 1 段 · 3384 字符" },
  ],
  external_sources: [],
  web_errors: [],
  usage: { prompt_tokens: 41280, completion_tokens: 1187, total_tokens: 42467 },
  cost_usd: null,
};

export const conversations: ResearchConversation[] = [
  { id: "conv-demo-1", title: "来给我总结一下去苏州旅游需要注意哪些点", turns: 1, status: "ready", latest_job_id: "job-demo-1" },
  { id: "conv-demo-2", title: "对比两条视频对园林取舍的说法", turns: 3, status: "ready", latest_job_id: "job-demo-2" },
  { id: "conv-demo-3", title: "大闸蟹到底什么时候能吃", turns: 2, status: "ready", latest_job_id: "job-demo-3" },
];

export const latestJob = job;
export const historyJob = job;

export const runningJob: ResearchJob = {
  ...job,
  job_id: "job-demo-live",
  conversation_id: "conv-demo-live",
  status: "analyzing",
  phase: "reading",
  document: null,
  coverage: [],
  external_sources: [],
  web_errors: [],
  usage: null,
  activity: [
    { id: "step-1", tool: "mcp__research__manifest", message: "manifest", status: "completed", summary: "4 条空间资料，0 条外部来源" },
    { id: "step-2", tool: "mcp__research__read_material", message: "read_material", status: "completed", summary: "苏州三天两夜｜避坑版行程 · body 第 1 段 · 2841 字符" },
    { id: "step-3", tool: "mcp__research__read_material", message: "read_material", status: "completed", summary: "苏州三天两夜｜避坑版行程 · comments 第 2 段 · 1902 字符" },
    { id: "step-4", tool: "mcp__research__read_material", message: "read_material", status: "running", summary: "苏州旅游到底有多坑？本地人说说 · comments 第 1 段" },
  ],
};

export const streamingJob: ResearchJob = {
  ...runningJob,
  job_id: "job-demo-stream",
  conversation_id: "conv-demo-stream",
  partial: [
    "### 先说结论",
    "",
    "这 4 条资料里，有两件事被反复提到：**景区门口的“内部票”基本都是拉客**，以及**古城内的短途交通不建议坐黄包车或游船**。其余的争论集中在大闸蟹和园林取舍上。",
    "",
    "### 一、门票与票价",
    "",
    "- 别信“内部人员低价门票”的兜售，老实走美团或景区门口买票；所谓丝绸博物馆、珍珠博物馆其实是商场 [S3:comments]。",
    "- **学生证多数景区半价**，研究生证能不能用要看具体景区 [S3:comments]。",
    "- 护城河内的热门区域常有“黄包车”拉客，不建议坐；竹筒奶茶、园区内小吃普遍又贵又一般 [S2:body]。",
    "",
    "### 二、避坑建议",
    "",
    "- 有游客反映**古运河游船体验很差**（5 分钟、周围在装修），“一日游”导游会反复劝购 [S3:comments]。",
    "- 写“苏式绿豆汤”“苏式火锅”的店不必尝试，9 月底前基本吃不到真正的阳澄湖大闸蟹 [S2:body]。",
    "",
  ].join("\n"),
};
