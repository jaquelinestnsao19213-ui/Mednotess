"use client";

import { useEffect, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { supabase } from "@/lib/supabase";

type EmbedInfo = { finalUrl: string; host: string; title: string; embeddable: boolean; readerHtml: string | null };
type Mode = "site" | "reader";

const READER_CSS = `
  body{font-family:Georgia,'Times New Roman',serif;line-height:1.65;color:#1d1d1f;margin:0;padding:18px 18px 40px;max-width:760px;margin-inline:auto;font-size:17px}
  h1,h2,h3,h4{font-family:system-ui,sans-serif;line-height:1.25;margin:1.4em 0 .5em}
  img{max-width:100%;height:auto;border-radius:6px}
  table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}
  td,th{border:1px solid #d0d0d0;padding:6px 8px;text-align:left}
  blockquote{margin:1em 0;padding-left:14px;border-left:3px solid #c9c9c9;color:#444}
  pre{overflow-x:auto;background:#f4f4f4;padding:10px;border-radius:6px}
  a{color:#0f5f59}
`;

// O site aparece dentro do próprio caderno. Quando o site não permite isso, mostra o texto em modo leitura.
export default function WebEmbedView({ node, updateAttributes, deleteNode, editor }: NodeViewProps) {
  const url = String(node.attrs.url ?? "");
  const [info, setInfo] = useState<EmbedInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [full, setFull] = useState(false);
  const [tall, setTall] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Sua sessão expirou. Entre novamente.");
        const response = await fetch("/api/embed", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ url }),
        });
        const data = (await response.json()) as EmbedInfo & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Não foi possível abrir esse site.");
        if (cancelled) return;
        setInfo(data);
        setMode((current) => current ?? (data.embeddable ? "site" : data.readerHtml ? "reader" : null));
        if (data.title && data.title !== node.attrs.title) updateAttributes({ title: data.title });
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Não foi possível abrir esse site.");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const title = String(node.attrs.title || info?.title || url);
  const host = info?.host ?? (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } })();
  const height = full ? undefined : tall ? 900 : 540;

  const bar = (
    <div className="pdfnb-bar">
      <span className="pdfnb-name" title={title}>🌐 {title}</span>
      <span className="pdfnb-status">{host}</span>
      <span className="pdfnb-sep" />
      {info?.embeddable && info.readerHtml && (
        <>
          <button type="button" className={mode === "site" ? "pdfnb-btn on" : "pdfnb-btn"} onClick={() => setMode("site")}>Site</button>
          <button type="button" className={mode === "reader" ? "pdfnb-btn on" : "pdfnb-btn"} onClick={() => setMode("reader")}>Leitura</button>
        </>
      )}
      {!full && <button type="button" className="pdfnb-btn" onClick={() => setTall((v) => !v)} aria-label="Alterar altura">{tall ? "Menor" : "Maior"}</button>}
      <button type="button" className={full ? "pdfnb-btn on" : "pdfnb-btn"} onClick={() => setFull((v) => !v)}>{full ? "Fechar" : "Tela cheia"}</button>
      <a className="pdfnb-btn" href={info?.finalUrl ?? url} target="_blank" rel="noopener noreferrer">Abrir ↗</a>
      {editor.isEditable && !full && <button type="button" className="pdfnb-btn" onClick={deleteNode} aria-label="Remover site">✕</button>}
    </div>
  );

  let body: React.ReactNode;
  if (error) {
    body = <p className="webnb-msg">{error} <a href={url} target="_blank" rel="noopener noreferrer">Abrir o site em outra aba</a></p>;
  } else if (!info || !mode) {
    body = !info
      ? <p className="webnb-msg">Carregando o site…</p>
      : <p className="webnb-msg">Esse site não permite ser exibido aqui e não tem texto que dê para mostrar em modo leitura. <a href={info.finalUrl} target="_blank" rel="noopener noreferrer">Abrir em outra aba</a></p>;
  } else if (mode === "site") {
    body = (
      <iframe
        className="webnb-frame"
        src={info.finalUrl}
        title={title}
        style={{ height: height ?? "100%" }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
      />
    );
  } else {
    body = (
      <>
        {!info.embeddable && <p className="webnb-note">Esse site não permite ser exibido dentro de outro app, então mostrei o texto em modo leitura (sem o layout original).</p>}
        <iframe
          className="webnb-frame"
          title={title}
          style={{ height: height ?? "100%" }}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>${READER_CSS}</style></head><body><h1>${title.replace(/</g, "&lt;")}</h1>${info.readerHtml ?? ""}</body></html>`}
        />
      </>
    );
  }

  return (
    <NodeViewWrapper className="pdf-block" contentEditable={false}>
      <div className={full ? "pdfnb webnb full" : "pdfnb webnb"}>
        {bar}
        {body}
      </div>
    </NodeViewWrapper>
  );
}
