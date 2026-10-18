import { createElement, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Archive, ArchiveRestore, ArrowUp, BookOpen, Captions, Check, ChevronDown, Columns2, Globe, History, LoaderCircle, Maximize2, MessageSquare, Minimize2, NotebookPen, Plus, Search, Sparkles, Square, Terminal, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import * as api from "./researchApi";
import { citedSources, platformLabel, readingSummary, referenceOf, sectionReading, sourceIndex, transcriptDuration, type SourceEntry } from "./researchPresentation";
import { numberingFor, partialDocument } from "./partial";
import { providerOf } from "./models";
import { spaceError } from "siye-host";
import type { NoteDocument, NoteBridge } from "./contract";
import type { WorkspaceSplitLayout } from "./contract";

const SESSIONS_WIDTH = 300;
const EFFORTS: { value: api.ResearchConfig["reasoning_effort"]; text: string }[] = [
  { value: "", text: "默认" },
  { value: "low", text: "低" },
  { value: "medium", text: "中" },
  { value: "high", text: "高" },
];

function formatTokens(value: number | undefined): string {
  if (!value || !Number.isFinite(value) || value <= 0) return "0";
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : String(Math.round(value));
}

/** 上下文上限只用于画环，按常见服务的窗口估算；未知服务按 128k 处理。 */
function contextWindowOf(baseUrl?: string): number {
  try {
    const host = new URL(baseUrl ?? "").hostname;
    if (host.includes("googleapis") || host.includes("generativelanguage")) return 1000000;
    if (host.includes("openai")) return 400000;
    if (host.includes("deepseek")) return 128000;
  } catch { /* fall through */ }
  return 128000;
}

function renderChildren(nodes: NoteDocument[] | undefined, sources: Record<string, SourceEntry>, numbering: Record<string, string>, key: string): ReactNode[] {
  const list = nodes ?? [];
  return list.reduce<ReactNode[]>((all, node, index) => {
    const reference = node.type === "text" && node.marks?.some((mark) => mark.type === "link") ? referenceOf(node.text ?? "") : null;
    if (reference) {
      // 同一来源连续出现时只保留一个角标，避免 “4 4” 这种重复。
      let previous: string | null = null;
      for (let back = index - 1; back >= 0; back -= 1) {
        const sibling = list[back];
        if (sibling.type === "text" && !(sibling.text ?? "").trim()) continue;
        previous = sibling.type === "text" ? referenceOf(sibling.text ?? "")?.citation ?? null : null;
        break;
      }
      if (previous === reference.citation) return all;
    }
    all.push(renderNode(node, sources, numbering, `${key}-${index}`));
    return all;
  }, []);
}

function renderNode(node: NoteDocument, sources: Record<string, SourceEntry>, numbering: Record<string, string>, key: string): ReactNode {
  const children = node.content ? renderChildren(node.content, sources, numbering, key) : undefined;
  if (node.type === "text") {
    const link = node.marks?.find((mark) => mark.type === "link");
    const reference = referenceOf(node.text ?? "");
    const source = reference ? sources[reference.citation] : undefined;
    if (reference && source) {
      return <sup key={key} className="research-cite"><a href={source.url} target="_blank" rel="noopener noreferrer"
        title={`${numbering[reference.citation] ?? reference.citation} · ${source.title}${reference.section ? ` · ${reference.section}` : ""}`}>{numbering[reference.citation] ?? reference.citation.replace(/^S/, "")}</a></sup>;
    }
    const value = node.marks?.some((mark) => mark.type === "bold") ? <strong>{node.text}</strong> : node.text;
    return link ? <a key={key} href={String(link.attrs?.href)} target="_blank" rel="noopener noreferrer">{value}</a> : <span key={key}>{value}</span>;
  }
  if (node.type === "heading") {
    const level = node.attrs?.level === 1 ? "h1" : node.attrs?.level === 2 ? "h2" : "h3";
    return createElement(level, { key }, children);
  }
  if (node.type === "paragraph") return <p key={key}>{children}</p>;
  if (node.type === "bulletList") return <ul key={key}>{children}</ul>;
  if (node.type === "orderedList") return <ol key={key} start={Number(node.attrs?.start) || 1}>{children}</ol>;
  if (node.type === "listItem") return <li key={key}>{children}</li>;
  return <div key={key}>{children}</div>;
}

function readLabel(row: api.ResearchJob["coverage"][number] | undefined, label: (key: string, fallback: string) => string): string {
  if (!row?.sections) return "";
  return (["body", "comments", "subtitles"] as const)
    .filter((name) => row.sections![name].chunks > 0)
    .map((name) => `${label(`research.component.${name}`, name === "body" ? "正文" : name === "comments" ? "评论" : "字幕")} ${row.sections![name].read_chunks}/${row.sections![name].chunks}`)
    .join(" · ");
}

function SourceList({ document, sources, coverage }: {
  document: NoteDocument | null; sources: Record<string, SourceEntry>; coverage: api.ResearchJob["coverage"];
}) {
  const { t } = useTranslation();
  const label = (key: string, fallback: string) => String(t(key, { defaultValue: fallback }) as unknown as string);
  const list = citedSources(document, sources);
  if (!list.length) return null;
  return <section className="research-sources" aria-label={t("research.coverage")}>
    <h3>{t("research.coverage", { defaultValue: "来源" })} · {list.length}</h3>
    <div className="research-source-list">
      {list.map((source, index) => {
        const row = coverage.find((item) => item.key === source.key);
        return <a className="research-source" key={source.citation} href={source.url} target="_blank" rel="noopener noreferrer">
          <b>{index + 1}</b>
          {source.platform ? <em>{platformLabel(source.platform)}</em> : <em>网页</em>}
          <span>{source.title}</span>
          <small>{readLabel(row, label)}</small>
        </a>;
      })}
    </div>
  </section>;
}

function LiveProgress({ row, elapsed, streaming }: { row: api.ResearchJob; elapsed: number; streaming: boolean }) {
  const { t } = useTranslation();
  const steps = (row.activity ?? []).filter((event) => event.kind !== "commentary").slice(-3);
  return <div className="research-live" role="status" aria-live="polite">
    <div className="research-live-head">
      <LoaderCircle className="research-tool-spinner" aria-hidden="true" />
      <strong>{t(`research.status.${row.status}`)}</strong>
      {row.status === "collecting" && row.total_materials > 0 && <span className="research-live-count">{row.materials.length} / {row.total_materials}</span>}
      {elapsed > 0 && <span className="research-live-time">{elapsed}s</span>}
    </div>
    {steps.length > 0 && <ol className="research-live-steps">{steps.map((event) => <li key={event.id ?? event.message}>
      {event.status === "running" ? <LoaderCircle className="research-tool-spinner" aria-hidden="true" /> : <Check aria-hidden="true" />}
      <span>{event.summary || event.message}</span>
    </li>)}</ol>}
    <div className="research-skeleton" aria-hidden="true" hidden={streaming}><i /><i /><i /></div>
  </div>;
}

export default function SpaceResearchPanel({ spaceId, spaceName, sourceCount, note, archived, open, onClose, split }: {
  spaceId: number; spaceName: string; sourceCount: number; note: NoteBridge; archived: boolean; open: boolean; onClose: () => void; split: WorkspaceSplitLayout;
}) {
  const { t } = useTranslation();
  const label = (key: string, fallback: string) => String(t(key, { defaultValue: fallback }) as unknown as string);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const body = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 1000px)").matches);
  const [width, setWidth] = useState(() => {
    try { return Math.max(360, Math.min(Number(localStorage.getItem("siye-research-width")) || 560, window.innerWidth)); } catch { return 560; }
  });
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [expanded, setExpanded] = useState(false);
  const drag = useRef<{ pointer: number; x: number; width: number; latest: number } | null>(null);
  const [dockedSessionsOpen, setDockedSessionsOpen] = useState(false);
  const sessionsOpen = split.active ? split.historyOpen : dockedSessionsOpen;
  const setSessionsOpen = split.active ? split.setHistoryOpen : setDockedSessionsOpen;
  const [sessionSearch, setSessionSearch] = useState("");
  const [sessionTab, setSessionTab] = useState<"recent" | "archived">("recent");
  const [modelOpen, setModelOpen] = useState(false);
  const [modelName, setModelName] = useState("");
  const modelBox = useRef<HTMLDivElement>(null);
  const [question, setQuestion] = useState("");
  const [web, setWeb] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const generationAttempt = useRef<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [job, setJob] = useState<api.ResearchJob | null>(null);
  const [turns, setTurns] = useState<api.ResearchJob[]>([]);
  const [initialized, setInitialized] = useState(false);
  const jobVersion = useRef(0);
  const config = useQuery({ queryKey: ["research-config"], queryFn: api.getResearchConfig, enabled: open, retry: false });
  const conversations = useQuery({ queryKey: ["research-conversations", spaceId], queryFn: () => api.listResearchConversations(spaceId), enabled: open, retry: false });
  const latest = useQuery({ queryKey: ["research-latest", spaceId], queryFn: async () => {
    const version = jobVersion.current;
    const next = await api.latestResearch(spaceId);
    const history = next ? await api.getResearchConversation(spaceId, next.conversation_id) : [];
    if (version === jobVersion.current) { setJob(next); setTurns(history); setInitialized(true); }
    return next;
  }, enabled: open && !initialized, retry: false, refetchOnWindowFocus: false });
  const preference = useQuery({ queryKey: ["research-web", spaceId], queryFn: () => api.getWebPreference(spaceId), enabled: open, retry: false });
  useEffect(() => { if (preference.data) setWeb(preference.data.web_enabled); }, [preference.data]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1000px)");
    const update = () => setNarrow(media.matches);
    const resize = () => setViewportWidth(window.innerWidth);
    media.addEventListener("change", update);
    window.addEventListener("resize", resize);
    return () => { media.removeEventListener("change", update); window.removeEventListener("resize", resize); };
  }, []);
  const minimumWidth = 360;
  const docked = sessionsOpen && !narrow;
  const chatWidth = split.active ? viewportWidth - split.noteWidth : narrow || expanded ? viewportWidth : Math.min(Math.max(width, minimumWidth), viewportWidth);
  const panelWidth = Math.min(chatWidth + (docked ? SESSIONS_WIDTH : 0), viewportWidth);
  const fullscreen = !split.active && !narrow && panelWidth === viewportWidth;
  useEffect(() => {
    if (!open) return;
    document.body.style.setProperty("--research-panel-width", `${panelWidth}px`);
    document.body.classList.toggle("has-ai-expanded", fullscreen);
    return () => { document.body.style.removeProperty("--research-panel-width"); document.body.classList.remove("has-ai-expanded"); };
  }, [open, panelWidth, fullscreen]);
  useEffect(() => {
    const element = dialog.current;
    if (!element || !open) return;
    if (narrow) element.showModal(); else element.show();
    return () => { element.close(); };
  }, [open, narrow]);
  useEffect(() => {
    const element = composer.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [question, open]);
  useEffect(() => {
    if (!modelOpen) return;
    const close = (event: PointerEvent) => {
      if (modelBox.current && !modelBox.current.contains(event.target as Node)) setModelOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [modelOpen]);
  const running = job?.status === "collecting" || job?.status === "analyzing";
  const locked = busy || running || job?.status === "awaiting_sources";
  const [clock, setClock] = useState(0);
  const started = useRef<{ id: string; at: number } | null>(null);
  useEffect(() => {
    if (!running || !job) { started.current = null; return; }
    if (started.current?.id !== job.job_id) started.current = { id: job.job_id, at: Date.now() };
    const timer = setInterval(() => setClock((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [running, job?.job_id]);
  const elapsed = clock >= 0 && started.current && started.current.id === job?.job_id ? Math.max(0, Math.round((Date.now() - started.current.at) / 1000)) : 0;
  useEffect(() => {
    if (!open || !running || !job) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const version = jobVersion.current;
      try {
        const next = await api.getResearch(job.job_id);
        if (!disposed && version === jobVersion.current) {
          setJob(next); setError("");
          if (!["collecting", "analyzing"].includes(next.status)) void conversations.refetch();
        }
      } catch (cause) { if (!disposed && version === jobVersion.current) setError(spaceError(cause)); }
      if (!disposed) timer = setTimeout(() => { void poll(); }, 500);
    };
    timer = setTimeout(() => { void poll(); }, 600);
    return () => { disposed = true; clearTimeout(timer); };
  }, [open, running, job?.job_id]);
  useEffect(() => {
    const element = body.current;
    if (!open || !element) return;
    const turns = element.querySelectorAll<HTMLElement>(".research-chat-turn");
    const last = turns[turns.length - 1];
    if (!last) { element.scrollTo({ top: 0 }); return; }
    // 长回答从问题处开始读，短回答贴底显示，避免一进来就落在正文中间。
    const offset = last.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop;
    element.scrollTo({ top: last.offsetHeight < element.clientHeight - 24 ? element.scrollHeight : Math.max(0, offset - 10) });
  }, [open, job?.job_id, job?.status, turns.length]);
  const run = async (operation: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try { await operation(); } catch (cause) { setError(spaceError(cause)); }
    finally { pending.current = false; setBusy(false); }
  };
  const updateJob = async (request: () => Promise<api.ResearchJob>) => {
    const version = ++jobVersion.current;
    const next = await request();
    if (version !== jobVersion.current) return;
    setJob(next); setInitialized(true);
    setTurns((previous) => [...previous.filter((row) => row.job_id !== next.job_id && row.conversation_id === next.conversation_id).map((row) => row.job_id === job?.job_id ? job : row), next]);
    void conversations.refetch();
  };
  const start = () => run(async () => {
    const conversation = job?.status === "ready" ? job.conversation_id : undefined;
    await updateJob(() => api.createResearch(spaceId, question, web, conversation));
    setQuestion("");
  });
  const newConversation = () => {
    jobVersion.current += 1; setInitialized(true); setJob(null); setTurns([]); setQuestion(""); setError(""); setNotice("");
    dialog.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  };
  const switchConversation = (id: string) => run(async () => {
    const version = ++jobVersion.current;
    const history = await api.getResearchConversation(spaceId, id);
    if (version !== jobVersion.current) return;
    setTurns(history); setJob(history[history.length - 1] ?? null); setInitialized(true); setQuestion("");
    if (narrow) setSessionsOpen(false);
  });
  const toggleArchive = (row: api.ResearchConversation) => run(async () => {
    await api.archiveResearchConversation(spaceId, row.id, !row.archived);
    await conversations.refetch();
  });
  const switchModel = (model: string) => run(async () => {
    const current = config.data;
    if (!current || current.model === model) { setModelOpen(false); return; }
    await api.saveResearchConfig(current.base_url, model, undefined, current.protocol);
    await config.refetch();
    setModelOpen(false);
    setModelName("");
  });
  const switchEffort = (value: api.ResearchConfig["reasoning_effort"]) => run(async () => {
    const current = config.data;
    if (!current || current.reasoning_effort === value) return;
    await api.saveResearchConfig(current.base_url, current.model, undefined, current.protocol, value);
    await config.refetch();
  });
  const append = (result: api.ResearchJob) => run(async () => {
    if (!result.document || note.hasSavedResearch(result.job_id) || wasApplied(result.job_id)) return;
    await note.append(result.job_id, result.document);
    setNotice(t("research.appended"));
  });
  useEffect(() => {
    if (job?.status === "collecting") generationAttempt.current = null;
    if (!open || !job || job.status !== "awaiting_sources" || archived || busy || pending.current || generationAttempt.current === job.job_id) return;
    generationAttempt.current = job.job_id;
    void run(async () => { await updateJob(() => api.researchAction(job.job_id, "generate")); });
  }, [open, job?.job_id, job?.status, archived, busy]);
  const displayed = job ? [...turns.filter((row) => row.job_id !== job.job_id), job] : [];
  const provider = config.data ? providerOf(config.data.base_url) : undefined;
  const modelService = provider?.name ?? (() => {
    try { return new URL(config.data?.base_url ?? "").hostname; } catch { return label("research.customService", "自定义服务"); }
  })();
  const modelOptions = Array.from(new Set([...(config.data?.model ? [config.data.model] : []), ...(provider?.models ?? [])]));
  const contextLimit = contextWindowOf(config.data?.base_url);
  const recentSessions = (conversations.data ?? []).filter((row) => !row.archived);
  const archivedSessions = (conversations.data ?? []).filter((row) => row.archived);
  const visibleSessions = (sessionTab === "archived" ? archivedSessions : recentSessions)
    .filter((row) => row.title.toLocaleLowerCase().includes(sessionSearch.toLocaleLowerCase()));
  const send = () => { if (!pending.current) void start(); };
  const sendDisabled = (sourceCount === 0 && job?.status !== "ready") || archived || busy || !initialized || !config.data?.has_key || !preference.data || !question.trim();
  const cancel = () => run(async () => { if (job) await updateJob(() => api.researchAction(job.job_id, "cancel")); });
  const toggleExpanded = () => {
    if (fullscreen) {
      setExpanded(false);
      if (width >= viewportWidth) {
        setWidth(560);
        try { localStorage.setItem("siye-research-width", "560"); } catch { /* Storage may be unavailable. */ }
      }
    } else { setExpanded(true); setSessionsOpen(true); }
  };
  return createPortal(<dialog ref={dialog} className={`space-research-dialog${fullscreen ? " is-expanded" : ""}${split.active ? " is-split" : ""}${docked ? " has-sessions" : ""}`} aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (sessionsOpen) setSessionsOpen(false); else if (split.active) split.restore(); else onClose(); } }}>
    {!narrow && <div className="research-resize-handle" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={t(split.active ? "spaces.resizeSplit" : "research.resizePanel")} title={split.active ? t("spaces.resizeSplitHint") : undefined} aria-valuemin={split.active ? 360 : minimumWidth} aria-valuemax={split.active ? viewportWidth - 360 : viewportWidth} aria-valuenow={split.active ? split.noteWidth : panelWidth}
      onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { pointer: event.pointerId, x: event.clientX, width: panelWidth, latest: panelWidth }; }}
      onPointerMove={(event) => { const start = drag.current; if (!start || start.pointer !== event.pointerId) return; if (split.active) { split.resize(viewportWidth - start.width + event.clientX - start.x); return; } start.latest = Math.max(minimumWidth, Math.min(start.width + start.x - event.clientX, viewportWidth)); setExpanded(false); setWidth(start.latest); }}
      onPointerUp={(event) => { if (drag.current) { if (!split.active) { try { localStorage.setItem("siye-research-width", String(drag.current.latest)); } catch { /* Storage may be unavailable. */ } } drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }}
      onLostPointerCapture={() => { drag.current = null; }}
      onDoubleClick={() => { if (split.active) split.resize(viewportWidth / 2); }}
      onKeyDown={(event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); if (split.active) { if (event.key !== "End") split.resize(event.key === "Home" ? viewportWidth / 2 : split.noteWidth + (event.key === "ArrowLeft" ? -24 : 24)); return; } const next = event.key === "Home" ? minimumWidth : event.key === "End" ? viewportWidth : Math.max(minimumWidth, Math.min(panelWidth + (event.key === "ArrowLeft" ? 24 : -24), viewportWidth)); setExpanded(false); setWidth(next); try { localStorage.setItem("siye-research-width", String(next)); } catch { /* Storage may be unavailable. */ } }} />}
    <section className="space-research">
      <header className="space-research-head">
        <div className="research-chat-title"><Sparkles aria-hidden="true" /><h2 id={titleId}>{t("research.title")}</h2></div>
        <div className="space-research-actions">
          <button type="button" className="research-icon-button" title={t("research.newConversation")} aria-label={t("research.newConversation")} disabled={!!locked || !initialized} onClick={newConversation}><Plus aria-hidden="true" /></button>
          <button type="button" className="research-icon-button" title={t("research.history")} aria-label={t("research.history")} aria-expanded={sessionsOpen} onClick={() => setSessionsOpen(!sessionsOpen)}><History aria-hidden="true" /></button>
          {!narrow && <button type="button" className="research-icon-button" title={t(split.active ? "spaces.restoreLayout" : "spaces.splitPanels")} aria-label={t(split.active ? "spaces.restoreLayout" : "spaces.splitPanels")} aria-pressed={split.active} onClick={split.active ? split.restore : split.enter}>{split.active ? <Minimize2 aria-hidden="true" /> : <Columns2 aria-hidden="true" />}</button>}
          {!narrow && !split.active && <button type="button" className="research-icon-button" title={t(fullscreen ? "research.collapsePanel" : "research.expandPanel")} aria-label={t(fullscreen ? "research.collapsePanel" : "research.expandPanel")} aria-expanded={fullscreen} onClick={toggleExpanded}>{fullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}</button>}
          <button type="button" className="research-icon-button" aria-label={t("research.close")} onClick={onClose}><X aria-hidden="true" /></button>
        </div>
      </header>
      <div className="research-chat-context"><span>{spaceName}</span><span>{t("research.selectedSources", { count: sourceCount })}</span></div>
      <div className="space-research-body" ref={body}>
        {config.data && !config.data.has_key && <p className="space-research-warning">{t("research.setupRequired")} <a href="#/settings/ai">{t("research.configure")}</a></p>}
        {!job && <div className="research-chat-empty">
          <div className="research-empty-mark"><Sparkles aria-hidden="true" /></div>
          <h3>{t("research.chatWelcome")}</h3>
          <p>{t(sourceCount === 0 ? "research.addSourcesFirst" : "research.chatIntro")}</p>
          <div className="research-starters">{["starterSummary", "starterCompare", "starterGaps"].map((key) => <button type="button" key={key} disabled={archived || sourceCount === 0} onClick={() => { setQuestion(t(`research.${key}`)); dialog.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus(); }}>{t(`research.${key}`)}</button>)}</div>
        </div>}
        {displayed.map((row) => {
          const current = row.job_id === job?.job_id;
          const rowInserted = note.hasResearch(row.job_id);
          const rowApplied = note.hasSavedResearch(row.job_id) || wasApplied(row.job_id);
          const sources = sourceIndex(row.materials, row.external_sources);
          const summary = readingSummary(row.coverage);
          const cited = citedSources(row.document, sources);
          const numbering = Object.fromEntries(cited.map((item, index) => [item.citation, String(index + 1)]));
          return <article className="research-chat-turn" key={row.job_id}>
            <div className="research-user-message"><p>{row.question || t("research.defaultQuestion")}</p></div>
            <div className="research-assistant-message">
              <div className="research-message-label">
                <span className="research-avatar"><Sparkles aria-hidden="true" /></span>
                <span>{t("research.assistantName")}</span>
                {row.document && summary.materials > 0 && <span className="research-evidence">
                  <span>{t("research.selectedSources", { count: summary.materials })}</span>
                  {summary.body.total > 0 && <span><BookOpen aria-hidden="true" />{t("research.component.body")} {summary.body.read}/{summary.body.total}</span>}
                  {summary.comments.total > 0 && <span><MessageSquare aria-hidden="true" />{t("research.component.comments")} {summary.comments.read}/{summary.comments.total}</span>}
                  {summary.subtitles.total > 0 && <span><Captions aria-hidden="true" />{t("research.component.subtitles")} {summary.subtitles.read}/{summary.subtitles.total}</span>}
                  {summary.unread > 0 && <span className="is-warn" title={t("research.unread")}>{label("research.partial", "部分未读完")}</span>}
                </span>}
              </div>
              {!row.document && <LiveProgress row={row} elapsed={current ? elapsed : 0} streaming={!!row.partial} />}
              {!row.document && row.partial && <div className="space-research-preview is-streaming">{renderChildren(partialDocument(row.partial).content, sources, numberingFor(row.partial, sources), `${row.job_id}-live`)}</div>}
              {row.error && <p role="alert">{row.error}</p>}
              {row.document && <div className="space-research-preview" aria-label={t("research.preview")}>{renderChildren(row.document.content, sources, numbering, row.job_id)}</div>}
              {row.document && <SourceList document={row.document} sources={sources} coverage={row.coverage} />}
              {!running && (row.materials.length > 0 || !!row.activity?.length || row.external_sources.length > 0 || row.web_errors.length > 0 || row.stale_snapshot) && <details className="research-tool-trace">
                <summary><ChevronDown aria-hidden="true" />{label("research.trace", "读取过程")}{row.activity?.length ? ` · ${row.activity.length}` : ""}</summary>
                <p className="space-research-hint">{t(row.web_enabled ? "research.webUsed" : "research.spaceUsed")}</p>
                {row.status === "collecting" && row.phase === "transcribing" && <p className="space-research-hint">{row.message}</p>}
                {row.stale_snapshot && <p className="space-research-warning">{t("research.stale")}</p>}
                {!!row.activity?.length && <div className="research-execution" aria-label={t("research.toolProcess")}>
                {row.activity.map((event, index) => event.kind === "commentary" ? <div className="research-process-commentary" key={event.id || index}><small>{t("research.processCommentary")}</small><p>{event.message}</p></div> : <details className={`research-tool-step is-${event.status || (event.message.includes("未完成") ? "failed" : "completed")}`} key={event.id || index}>
                  <summary><Terminal aria-hidden="true" /><strong>{event.tool.replace("mcp__research__", "")}</strong><span>{event.message !== event.tool ? event.message : event.summary}</span>{event.status === "running" && ["failed", "cancelled"].includes(row.status) ? <X aria-label={t("research.toolState.cancelled")} /> : event.status === "running" ? <LoaderCircle className="research-tool-spinner" aria-label={t("research.toolState.running")} /> : event.status === "failed" || event.status === "cancelled" ? <X aria-label={t(`research.toolState.${event.status}`)} /> : <Check aria-label={t("research.toolState.completed")} />}</summary>
                  <div className="research-tool-result"><span>{t(`research.toolState.${event.status === "running" && ["failed", "cancelled"].includes(row.status) ? "cancelled" : event.status || "completed"}`)}</span><p>{event.summary || event.message}</p></div>
                </details>)}
                </div>}
                {row.materials.length > 0 && <section className="research-material-details"><h3>{t("research.coverage")} · {row.materials.length}</h3>
                  <div className="space-research-materials">{row.materials.map((item) => <article key={item.key}>
                    <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
                    <div className="space-research-tags">{(["body", "comments", "subtitles"] as const).map((name) => <span key={name} className={`space-research-tag is-${item[name].state}`}>
                      {t(`research.component.${name}`)} {item[name].state === "ok" ? "✓" : item[name].state === "not_applicable" ? "·" : "×"} {t(`research.state.${item[name].state}`)}{name === "comments" && ` · ${t("research.commentCount", { count: item[name].count })}`}
                      {name === "subtitles" && item[name].metadata?.source && ` · ${transcriptDuration(item[name].metadata?.duration)} · ${t(`research.subtitleSource.${item[name].metadata?.source}`)}`}
                      {(item[name].collection_truncated ?? item[name].truncated) && ` · ${t("research.collectionPartial")}`}
                    </span>)}</div>
                    {(["body", "comments", "subtitles"] as const).map((name) => item[name].reason && <p key={name} className="space-research-hint">{t(`research.component.${name}`)}：{item[name].reason}</p>)}
                    {item.comments.sort && <p className="space-research-hint">{item.comments.sort}</p>}
                    {row.coverage.find((source) => source.key === item.key)?.sections && <p className="space-research-hint">{(["body", "comments", "subtitles"] as const).map((name) => {
                      const section = row.coverage.find((source) => source.key === item.key)!.sections![name];
                      return `${t(`research.component.${name}`)} ${t(sectionReading(section, name === "comments"), { read: section.read_chunks, total: section.chunks, count: section.count })}`;
                    }).join(" · ")}</p>}
                  </article>)}</div>
                </section>}
                {row.web_errors.length > 0 && <p className="space-research-hint">{t("research.webFailed")}</p>}
                {row.external_sources.length > 0 && <section className="research-external-sources"><h3>{t("research.externalSources")}</h3>{row.external_sources.map((source) => <p key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a><span> · {source.level} · {source.fetched_at}</span></p>)}</section>}
              </details>}
              {current && row.status === "awaiting_sources" && <div className="research-source-review"><p>{t("research.reviewChatHint")}</p><div className="space-research-actions">
                <button type="button" className="btn small primary" disabled={busy || archived} onClick={() => void run(async () => { await updateJob(() => api.researchAction(row.job_id, "generate")); })}>{t("research.continue")}</button>
                <button type="button" className="btn small" disabled={busy || archived} onClick={() => void run(async () => { await updateJob(() => api.researchAction(row.job_id, "retry")); })}>{t("research.retrySources")}</button>
              </div></div>}
              {row.document && <>
                {rowInserted && !rowApplied && <p className="space-research-warning">{t("research.draftInserted")}</p>}
                <div className="research-reply-actions"><button type="button" className="btn small primary research-write-note" disabled={archived || busy || note.conflict || rowApplied} onClick={() => void append(row)}>{rowApplied ? <Check aria-hidden="true" /> : <NotebookPen aria-hidden="true" />}{t(rowApplied ? "research.appended" : rowInserted ? "research.retrySave" : "research.append")}</button></div>
              </>}
              {current && row.status === "failed" && <button type="button" className="btn small" disabled={busy || archived} onClick={() => void run(async () => { await updateJob(() => api.researchAction(row.job_id, "retry")); })}>{t("research.retrySources")}</button>}
            </div>
          </article>;
        })}
      </div>
      <div className="space-research-footer">
        {(error || config.error || latest.error || preference.error || conversations.error) && <p role="alert">{error || spaceError(config.error || latest.error || preference.error || conversations.error)}</p>}
        {notice && <p role="status">{notice}</p>}
        <div className="research-input-card">
          <textarea ref={composer} aria-label={t("research.messageInput")} rows={1} maxLength={2000} value={question} placeholder={t("research.messagePlaceholder")} disabled={!!locked || archived} onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && !locked && !sendDisabled) { event.preventDefault(); send(); } }} />
          <div className="research-input-tools">
            <div className="research-model" ref={modelBox}>
              <button type="button" className="research-model-label" title={config.data?.base_url} aria-haspopup="menu" aria-expanded={modelOpen}
                disabled={!!locked || !config.data?.has_key} onClick={() => setModelOpen((value) => !value)}>
                <span>{config.data?.model || t("research.noModel")}</span>
                <em>·</em>
                <b>{EFFORTS.find((row) => row.value === (config.data?.reasoning_effort ?? ""))?.text ?? "默认"}</b>
                <ChevronDown aria-hidden="true" />
              </button>
              {modelOpen && <div className="research-model-menu" role="menu">
                <p className="research-model-service">{modelService}</p>
                {modelOptions.map((name) => <button type="button" role="menuitemradio" aria-checked={config.data?.model === name} key={name} className="research-model-option" onClick={() => void switchModel(name)}>
                  <span>{name}</span>{config.data?.model === name && <Check aria-hidden="true" />}
                </button>)}
                <form className="research-model-custom" onSubmit={(event) => { event.preventDefault(); if (modelName.trim()) void switchModel(modelName.trim()); }}>
                  <input aria-label={label("research.customModel", "自定义模型名")} value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder={label("research.customModel", "自定义模型名")} />
                  <button type="submit" disabled={!modelName.trim() || busy}>{label("research.applyModel", "切换")}</button>
                </form>
                <div className="research-effort-block">
                  <p className="research-model-service">{label("research.effort", "推理等级")}</p>
                  <div className="research-effort-seg" role="radiogroup" aria-label={label("research.effort", "推理等级")}>
                    {EFFORTS.map((row) => <button type="button" role="radio" key={row.value || "default"} aria-checked={(config.data?.reasoning_effort ?? "") === row.value}
                      className={(config.data?.reasoning_effort ?? "") === row.value ? "is-active" : ""} disabled={busy} onClick={() => void switchEffort(row.value)}>{row.text}</button>)}
                  </div>
                  <p className="research-effort-note">{label("research.effortNote", "服务不支持该参数时自动按默认重试。")}</p>
                </div>
                <a className="research-model-link" href="#/settings/ai">{label("research.modelSettings", "打开模型设置")}</a>
              </div>}
            </div>
            <label className="research-web-toggle" title={t(web ? "research.webHint" : "research.localHint")}><input type="checkbox" aria-label={t("research.allowWeb")} checked={web} disabled={busy || !preference.data} onChange={(event) => {
              const enabled = event.target.checked; setWeb(enabled);
              void run(async () => { try { await api.saveWebPreference(spaceId, enabled); } catch (cause) { setWeb(!enabled); throw cause; } });
            }} /><Globe aria-hidden="true" /><span>{t("research.webShort")}</span></label>
            <span className="research-tools-spacer" aria-hidden="true" />
            {!!job?.context_tokens && <span className="research-context" title={`${label("research.context", "上下文")} ${formatTokens(job.context_tokens)} / ${formatTokens(contextLimit)}（估算）`}>
              <svg viewBox="0 0 38 21" aria-hidden="true">
                <path className="research-context-track" d="M3 18 A16 16 0 0 1 35 18" />
                <path className="research-context-value" d="M3 18 A16 16 0 0 1 35 18"
                  style={{ strokeDasharray: `${Math.min(job.context_tokens / contextLimit, 1) * 50.27} 50.27` }} />
              </svg>
              <span>{Math.min(100, Math.round((job.context_tokens / contextLimit) * 100))}%</span>
            </span>}
            {running || job?.status === "awaiting_sources" ? <button type="button" className="research-send" aria-label={t("research.cancel")} title={t("research.cancel")} disabled={busy} onClick={() => void cancel()}><Square aria-hidden="true" /></button>
              : <button type="button" className="research-send" aria-label={t("research.send")} title={t("research.send")} disabled={sendDisabled} onClick={send}><ArrowUp aria-hidden="true" /></button>}
          </div>
        </div>
        <p className="research-input-hint">{t("research.sendShortcut")}</p>
      </div>
    </section>
      {sessionsOpen && <>
        {!docked && <div className="research-sessions-scrim" aria-hidden="true" onClick={() => setSessionsOpen(false)} />}
        <aside className={`research-sessions ${docked ? "is-docked" : "is-overlay"}`} aria-label={t("research.history")}>
          <div className="research-sessions-head"><h3>{t("research.history")}</h3><button type="button" className="research-icon-button" aria-label={t("research.closeHistory")} onClick={() => setSessionsOpen(false)}><X aria-hidden="true" /></button></div>
          <button type="button" className="research-session-new" disabled={!!locked || !initialized} onClick={newConversation}><Plus aria-hidden="true" />{t("research.newConversation")}</button>
          <label className="research-session-search"><Search aria-hidden="true" /><input aria-label={t("research.searchHistory")} value={sessionSearch} onChange={(event) => setSessionSearch(event.target.value)} placeholder={t("research.searchHistory")} /></label>
          <div className="research-session-tabs" role="tablist">
            {(["recent", "archived"] as const).map((tab) => <button type="button" role="tab" key={tab} aria-selected={sessionTab === tab}
              className={sessionTab === tab ? "is-active" : ""} onClick={() => setSessionTab(tab)}>
              {label(`research.tab.${tab}`, tab === "recent" ? "最近" : "已归档")}
              <span>{tab === "recent" ? recentSessions.length : archivedSessions.length}</span>
            </button>)}
          </div>
          <div className="research-session-list">
            {visibleSessions.length === 0
              ? <p className="research-session-empty">{label(sessionTab === "archived" ? "research.emptyArchived" : "research.emptyRecent", sessionTab === "archived" ? "还没有归档的会话" : "还没有会话")}</p>
              : visibleSessions.map((row) => <div className={`research-session-item${job?.conversation_id === row.id ? " is-active" : ""}`} key={row.id}>
                <button type="button" className="research-session-open" aria-pressed={job?.conversation_id === row.id} disabled={!!locked || !initialized} onClick={() => void switchConversation(row.id)}>
                  <MessageSquare aria-hidden="true" /><span>{row.title}<small>{t("research.conversationTurns", { count: row.turns })}</small></span>
                </button>
                <button type="button" className="research-session-archive" disabled={!!locked || !initialized}
                  title={label(row.archived ? "research.unarchive" : "research.archive", row.archived ? "取消归档" : "归档")}
                  aria-label={label(row.archived ? "research.unarchive" : "research.archive", row.archived ? "取消归档" : "归档")}
                  onClick={() => void toggleArchive(row)}>{row.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}</button>
              </div>)}
          </div>
          <p className="space-research-hint">{t("research.historyHint")}</p>
        </aside>
      </>}
  </dialog>, document.body);
}

function wasApplied(identity: string): boolean {
  try { return localStorage.getItem(`siye-research-applied:${identity}`) === "1"; } catch { return false; }
}
