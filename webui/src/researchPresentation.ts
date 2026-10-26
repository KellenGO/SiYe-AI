import type { NoteDocument } from "./contract";
import type { ResearchJob, ResearchMaterial, SectionCoverage } from "./researchApi";

export function transcriptDuration(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes.toString().padStart(2, "0")}:${(whole % 60).toString().padStart(2, "0")}`;
}

export function sectionReading(section: { chunks: number; read_chunks: number; reading_complete?: boolean; content_limited?: boolean }, comments: boolean): string {
  if (!section.chunks) return "research.sectionUnavailable";
  if (comments && !section.content_limited && (section.reading_complete ?? section.read_chunks === section.chunks)) return "research.sampleRead";
  return "research.sectionRead";
}

const REFERENCE = /^\[([SW]\d+)(?::(body|comments|subtitles|ocr))?\]$/;

export interface SourceEntry {
  citation: string;
  key?: string;
  title: string;
  url: string;
  platform?: string;
  kind: "space" | "web";
}

export function platformLabel(platform?: string): string {
  return ({ xhs: "小红书", bilibili: "B站", douyin: "抖音", zhihu: "知乎", youtube: "YouTube", weibo: "微博" } as Record<string, string>)[platform ?? ""] ?? platform ?? "";
}

/** 引用编号与资料顺序一致：S1 是本次清单的第一条，W1 是第一条外部网页。 */
export function sourceIndex(materials: ResearchMaterial[], external: ResearchJob["external_sources"]): Record<string, SourceEntry> {
  const map: Record<string, SourceEntry> = {};
  materials.forEach((item, index) => {
    map[`S${index + 1}`] = { citation: `S${index + 1}`, key: item.key, title: item.title, url: item.url, platform: item.platform, kind: "space" };
  });
  external.forEach((item, index) => {
    map[`W${index + 1}`] = { citation: `W${index + 1}`, title: item.title, url: item.url, kind: "web" };
  });
  return map;
}

export function referenceOf(value: string): { citation: string; section?: string } | null {
  const match = REFERENCE.exec(value.trim());
  return match ? { citation: match[1], section: match[2] } : null;
}

/** 只收集正文里真正出现过的引用，按首次出现顺序排列。 */
export function citedSources(document: NoteDocument | null, sources: Record<string, SourceEntry>): SourceEntry[] {
  const seen: string[] = [];
  const walk = (nodes?: NoteDocument[]) => {
    for (const node of nodes ?? []) {
      if (node.type === "text" && node.marks?.some((mark) => mark.type === "link")) {
        const reference = referenceOf(node.text ?? "");
        if (reference && !seen.includes(reference.citation)) seen.push(reference.citation);
      }
      walk(node.content);
    }
  };
  walk(document?.content);
  return seen.map((citation) => sources[citation]).filter(Boolean);
}

export interface ReadingSummary {
  materials: number;
  cited: number;
  body: { read: number; total: number };
  comments: { read: number; total: number };
  subtitles: { read: number; total: number };
  ocr: { read: number; total: number };
  unread: number;
}

function tally(coverage: ResearchJob["coverage"], section: "body" | "comments" | "subtitles" | "ocr") {
  let read = 0;
  let total = 0;
  for (const row of coverage) {
    const value: SectionCoverage | undefined = row.sections?.[section];
    if (!value || !value.chunks) continue;
    total += 1;
    if (value.reading_complete ?? value.read_chunks === value.chunks) read += 1;
  }
  return { read, total };
}

export function readingSummary(coverage: ResearchJob["coverage"]): ReadingSummary {
  return {
    materials: coverage.length,
    cited: 0,
    body: tally(coverage, "body"),
    comments: tally(coverage, "comments"),
    subtitles: tally(coverage, "subtitles"),
    ocr: tally(coverage, "ocr"),
    unread: coverage.filter((row) => !(row.required_complete ?? row.complete)).length,
  };
}
