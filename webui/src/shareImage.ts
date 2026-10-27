/** Rasterize our text-only share card using browser APIs, without uploading content. */
const MAX_PIXELS = 32_000_000;
const MAX_SIDE = 30_000;
const MAX_TEXT = 120_000;
const STYLES = [
  "display", "position", "box-sizing", "width", "height", "min-width", "max-width", "min-height", "max-height",
  "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "color", "background-color",
  "border-top", "border-right", "border-bottom", "border-left", "border-radius", "text-align", "text-decoration",
  "white-space", "word-break", "overflow-wrap", "vertical-align", "list-style-type", "list-style-position",
  "flex-direction", "flex-wrap", "align-items", "justify-content", "gap", "flex", "opacity", "overflow",
];

export class ShareImageError extends Error {
  constructor(public code: "too_large" | "render_failed") { super(code); }
}

export function shareImageSize(width: number, height: number, textLength: number): { width: number; height: number; scale: number } {
  if (!(width > 0 && height > 0) || !Number.isFinite(width + height + textLength)) throw new ShareImageError("render_failed");
  const scale = Math.min(2, MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_PIXELS / (width * height)));
  if (textLength > MAX_TEXT || scale < 1) throw new ShareImageError("too_large");
  return { width: Math.floor(width * scale), height: Math.floor(height * scale), scale };
}

export async function createShareImage(card: HTMLElement): Promise<Blob> {
  await document.fonts.ready;
  const width = card.offsetWidth;
  const height = card.scrollHeight;
  const size = shareImageSize(width, height, card.textContent?.length ?? 0);
  const copy = card.cloneNode(true) as HTMLElement;
  const originals = [card, ...card.querySelectorAll<HTMLElement>("*")];
  const copies = [copy, ...copy.querySelectorAll<HTMLElement>("*")];
  originals.forEach((original, index) => {
    const computed = getComputedStyle(original);
    STYLES.forEach((name) => copies[index].style.setProperty(name, computed.getPropertyValue(name)));
  });
  copy.style.transform = "none";
  copy.style.position = "static";
  copy.style.width = `${width}px`;
  copy.style.height = `${height}px`;
  copy.style.maxHeight = "none";
  // Only application-rendered text and source links belong in the exported card.
  copy.querySelectorAll("script,style,img,video,audio,iframe,canvas,button,input").forEach((node) => node.remove());
  const markup = new XMLSerializer().serializeToString(copy);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;
  const picture = new Image();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ShareImageError("render_failed")), 15000);
    picture.onload = () => { clearTimeout(timer); resolve(); };
    picture.onerror = () => { clearTimeout(timer); reject(new ShareImageError("render_failed")); };
    picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new ShareImageError("render_failed");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new ShareImageError("render_failed")), "image/png"));
  } catch {
    throw new ShareImageError("render_failed");
  } finally {
    canvas.width = canvas.height = 1;
  }
}

export function downloadShareImage(blob: Blob, title: string): void {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `四野-${title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 50) || "AI"}.png`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
