import type { NoteDocument } from "./contract";

/** 流式回答还没定稿时的轻量渲染：只按行切块，等定稿再换成服务端校验过的文档。 */
const INLINE = /(\*\*[^*\n]+\*\*|\[[SW]\d+(?::(?:body|comments|subtitles|ocr))?\])/;

function inline(value: string): NoteDocument[] {
  return value.split(INLINE).filter((part) => part !== "").map((part) => {
    if (/^\*\*[^*\n]+\*\*$/.test(part)) return { type: "text", text: part.slice(2, -2), marks: [{ type: "bold" }] };
    if (/^\[[SW]\d+(?::(?:body|comments|subtitles|ocr))?\]$/.test(part)) return { type: "text", text: part, marks: [{ type: "link" }] };
    return { type: "text", text: part };
  });
}

export function partialDocument(text: string): NoteDocument {
  const content: NoteDocument[] = [];
  for (const line of text.split("\n")) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const item = /^\s*(?:([-*+])\s+|(\d+)\.\s+)(.+)$/.exec(line);
    if (heading) {
      content.push({ type: "heading", attrs: { level: Math.min(heading[1].length, 3) }, content: inline(heading[2]) });
    } else if (item) {
      const kind = item[1] ? "bulletList" : "orderedList";
      const node: NoteDocument = { type: "listItem", content: [{ type: "paragraph", content: inline(item[3]) }] };
      const last = content[content.length - 1];
      if (last?.type === kind) last.content?.push(node);
      else content.push({ type: kind, content: [node] });
    } else {
      content.push({ type: "paragraph", content: inline(line) });
    }
  }
  return { type: "doc", content };
}

/** 流式阶段按出现顺序给来源编号，定稿后编号保持一致。 */
export function numberingFor(text: string, sources: Record<string, unknown>): Record<string, string> {
  const map: Record<string, string> = {};
  let next = 0;
  for (const match of text.matchAll(/\[([SW]\d+)(?::(?:body|comments|subtitles|ocr))?\]/g)) {
    if (!(match[1] in map) && match[1] in sources) map[match[1]] = String(++next);
  }
  return map;
}
