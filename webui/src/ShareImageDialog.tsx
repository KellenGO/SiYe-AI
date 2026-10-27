import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Download, LoaderCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { citedSources, sourceIndex } from "./researchPresentation";
import { createShareImage, downloadShareImage, ShareImageError } from "./shareImage";
import type { ResearchJob } from "./researchApi";

export default function ShareImageDialog({ title, turns, renderAnswer, onClose }: {
  title: string; turns: ResearchJob[]; renderAnswer(row: ResearchJob): ReactNode; onClose(): void;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [questions, setQuestions] = useState(true);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const version = useRef(0);
  const exporting = useRef(false);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => { version.current += 1; element.close(); };
  }, []);
  useEffect(() => {
    const update = () => {
      if (viewport.current && card.current) {
        setScale(Math.min(1, Math.max(0.1, (viewport.current.clientWidth - 32) / 720)));
        setHeight(card.current.scrollHeight);
      }
    };
    const observer = new ResizeObserver(update);
    if (viewport.current) observer.observe(viewport.current);
    if (card.current) observer.observe(card.current);
    update();
    return () => observer.disconnect();
  }, []);
  const save = async () => {
    if (!card.current || exporting.current) return;
    exporting.current = true; setBusy(true); setError(""); setSaved(false);
    const current = version.current;
    try {
      const image = await createShareImage(card.current);
      if (version.current !== current) return;
      downloadShareImage(image, title);
      setSaved(true);
    } catch (cause) {
      if (version.current === current) setError(String(t(cause instanceof ShareImageError && cause.code === "too_large" ? "research.shareTooLarge" : "research.shareFailed")));
    } finally {
      exporting.current = false;
      if (version.current === current) setBusy(false);
    }
  };
  return <dialog ref={dialog} className="research-share-dialog" aria-labelledby="research-share-title"
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}>
    <header className="research-share-head"><h2 id="research-share-title">{t("research.sharePreview")}</h2><button type="button" className="research-icon-button" aria-label={t("research.closeSharePreview")} title={t("research.closeSharePreview")} onClick={onClose}><X aria-hidden="true" /></button></header>
    <div className="research-share-viewport" ref={viewport}>
      <div className="research-share-scaled" style={{ width: 720 * scale, height: height * scale }}>
        <div ref={card} className="research-share-card" style={{ transform: `scale(${scale})` }}>
          <div className="research-share-brand"><span className="research-share-mark" aria-hidden="true"><i /><i /><i /><i /></span><strong>四野</strong><span>{t("research.assistantName")}</span></div>
          <div className="research-share-topic">{title}</div>
          {turns.map((row) => {
            const sources = citedSources(row.document, sourceIndex(row.materials, row.external_sources));
            return <section className="research-share-turn" key={row.job_id}>
              {questions && <div className="research-share-question">{row.question || t("research.defaultQuestion")}</div>}
              <div className="research-share-answer">{renderAnswer(row)}</div>
              {sources.length > 0 && <div className="research-share-sources"><h3>{t("research.shareSources")}</h3>{sources.map((source, index) => <div className="research-share-source" key={source.citation}><b>{index + 1}</b><div><strong>{source.title}</strong><span>{source.url}</span></div></div>)}</div>}
            </section>;
          })}
          <div className="research-share-signature">{t("research.shareSignature")}</div>
        </div>
      </div>
    </div>
    <footer className="research-share-footer">
      <label className="research-share-question-toggle"><input type="checkbox" checked={questions} disabled={busy} onChange={(event) => { setQuestions(event.target.checked); setSaved(false); setError(""); }} />{t("research.shareIncludeQuestions")}</label>
      {error && <p role="alert">{error}</p>}{saved && <p role="status">{t("research.shareSaved")}</p>}
      <div className="research-share-dialog-actions"><button type="button" className="btn small" onClick={onClose}><ArrowLeft aria-hidden="true" />{t("research.shareBack")}</button><button type="button" className="btn small primary" disabled={busy} onClick={() => void save()}>{busy ? <LoaderCircle className="research-tool-spinner" aria-hidden="true" /> : <Download aria-hidden="true" />}{t(busy ? "research.shareSaving" : "research.shareSave")}</button></div>
    </footer>
  </dialog>;
}
