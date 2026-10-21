import type { NoteDocument } from "./contract";

/** Keep source links when copying an answer out of the assistant. */
export function answerText(node: NoteDocument): string {
  if (node.type === "text") {
    const link = node.marks?.find((mark) => mark.type === "link");
    return link?.attrs?.href ? `[${node.text ?? ""}](${String(link.attrs.href)})` : node.text ?? "";
  }
  const children = node.content ?? [];
  if (node.type === "bulletList" || node.type === "orderedList") {
    const start = Number(node.attrs?.start) || 1;
    return children.map((child, index) => `${node.type === "bulletList" ? "-" : `${start + index}.`} ${answerText(child)}`).join("\n");
  }
  const content = children.map(answerText).join(["paragraph", "heading"].includes(node.type) ? "" : "\n");
  return node.type === "heading" ? `${"#".repeat(Math.min(6, Math.max(1, Number(node.attrs?.level) || 2)))} ${content}` : content;
}

export function quotedQuestion(text: string, draft: string): string {
  return `> ${text.trim().replace(/\n/g, "\n> ")}\n\n${draft}`;
}
