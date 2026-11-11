"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { type Crop, type Curve, type EdgeKind, type MapDoc, type MapEdge, type MapNode, type NodeData, type Shape, PALETTE, PALETTE_NAMES, canReparent, childrenOf, descendantsOf, nodeById, paletteStyle, parentOf } from "@/lib/mindmap";
import type { TreePage } from "@/lib/page-tree";
import PagePicker from "./PagePicker";

export type InspectorActions = {
  patchNodes: (ids: string[], patch: Partial<NodeData>, coalesce?: string) => void;
  endCoalesce: () => void;
  patchEdge: (id: string, patch: Partial<MapEdge>, coalesce?: string) => void;
  setEdgeKind: (id: string, kind: EdgeKind) => void;
  reverseEdge: (id: string) => void;
  removeEdges: (ids: string[]) => void;
  addChild: (id: string) => void;
  addSibling: (id: string) => void;
  toggle: (id: string) => void;
  reparent: (id: string, parentId: string | null) => void;
  removeNodes: (ids: string[], withBranch: boolean) => void;
  replaceImage: (id: string) => void;
  startEdit: (id: string) => void;
};

function Swatches({ value, onPick, allowAuto, onAuto }: { value?: string; onPick: (c: string) => void; allowAuto?: boolean; onAuto?: () => void }) {
  return (
    <div className="mm-swatches" role="radiogroup" aria-label="Cor">
      {allowAuto && <button type="button" className={`mm-swatch mm-swatch-auto${!value ? " on" : ""}`} onClick={onAuto} title="Automática (cor do ramo)">A</button>}
      {PALETTE_NAMES.map((name) => (
        <button key={name} type="button" role="radio" aria-checked={value === name} aria-label={PALETTE[name].label} title={PALETTE[name].label} className={`mm-swatch${value === name ? " on" : ""}`} style={{ background: PALETTE[name].fill, borderColor: PALETTE[name].border }} onClick={() => onPick(name)} />
      ))}
      <label className="mm-swatch mm-swatch-custom" title="Outra cor">
        <input type="color" value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : paletteStyle(value).border} onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="mm-seg" role="group">
      {options.map(([v, label]) => <button key={v} type="button" className={value === v ? "on" : ""} onClick={() => onChange(v)}>{label}</button>)}
    </div>
  );
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="mm-field"><span className="mm-field-label">{label}</span>{children}</div>
);

function SourceLink({ node, pages, actions }: { node: MapNode; pages: TreePage[]; actions: InspectorActions }) {
  const [picking, setPicking] = useState(false);
  const d = node.data;
  const page = d.pageId ? pages.find((p) => p.id === d.pageId) : null;
  return (
    <Field label="Anotação vinculada">
      {d.pageId ? (
        <div className="mm-source">
          <strong>{page ? `${page.icon ? page.icon + " " : ""}${page.title || "Sem título"}` : "Anotação não encontrada (pode ter sido excluída)"}</strong>
          {d.excerpt ? <blockquote>{d.excerpt}</blockquote> : <small className="mm-hint">Sem trecho registrado.</small>}
          <div className="mm-row">
            {page && <Link className="mm-btn" href={`/p/${d.pageId}`} target="_blank" rel="noopener">Abrir anotação ↗</Link>}
            <button type="button" className="mm-btn" onClick={() => setPicking((v) => !v)}>Trocar</button>
            <button type="button" className="mm-btn mm-btn-danger" onClick={() => actions.patchNodes([node.id], { pageId: null, excerpt: null })}>Remover vínculo</button>
          </div>
        </div>
      ) : (
        <button type="button" className="mm-btn" onClick={() => setPicking((v) => !v)}>Vincular a uma anotação</button>
      )}
      {picking && (
        <PagePicker pages={pages} multiple={false} selected={d.pageId ? [d.pageId] : []} height={200} onChange={(ids) => { actions.patchNodes([node.id], { pageId: ids[0] ?? null, ...(ids[0] ? {} : { excerpt: null }) }); setPicking(false); }} />
      )}
      {d.pageId && (
        <textarea className="mm-input" rows={2} placeholder="Trecho da anotação (opcional)" value={d.excerpt ?? ""} onFocus={() => actions.endCoalesce()} onBlur={actions.endCoalesce} onChange={(e) => actions.patchNodes([node.id], { excerpt: e.target.value.slice(0, 300) }, `ex-${node.id}`)} />
      )}
    </Field>
  );
}

export default function Inspector({ doc, selectedNodes, selectedEdges, pages, actions }: {
  doc: MapDoc; selectedNodes: string[]; selectedEdges: string[]; pages: TreePage[]; actions: InspectorActions;
}) {
  const nodes = selectedNodes.map((id) => nodeById(doc, id)).filter((n): n is MapNode => !!n);
  const edge = selectedEdges.length === 1 && !nodes.length ? doc.edges.find((e) => e.id === selectedEdges[0]) : undefined;

  const parentOptions = useMemo(() => {
    if (nodes.length !== 1) return [];
    const id = nodes[0].id;
    const banned = descendantsOf(doc, id);
    return doc.nodes.filter((n) => n.kind === "concept" && n.id !== id && !banned.has(n.id) && canReparent(doc, id, n.id).ok);
  }, [doc, nodes]);

  if (!nodes.length && !edge) {
    return (
      <div className="mm-panel-body">
        <p className="mm-hint"><strong>Nada selecionado.</strong> Toque num conceito, numa seta, numa imagem ou numa caixa para editar cor, forma, texto, vínculo com anotações e posição na hierarquia.</p>
        <ul className="mm-tips">
          <li>Toque duas vezes num conceito para escrever direto nele.</li>
          <li>Arraste de uma bolinha do conceito para outro para criar uma seta; solte no vazio para criar um filho.</li>
          <li>No computador: Tab cria filho, Enter cria irmão, Delete exclui, Ctrl+Z desfaz.</li>
        </ul>
      </div>
    );
  }

  if (nodes.length > 1) {
    const ids = nodes.map((n) => n.id);
    return (
      <div className="mm-panel-body">
        <h3 className="mm-panel-title">{nodes.length} itens selecionados</h3>
        <Field label="Cor"><Swatches value={undefined} onPick={(c) => actions.patchNodes(ids, { color: c })} /></Field>
        <Field label="Tamanho do texto"><input type="range" min={11} max={28} defaultValue={15} onPointerDown={actions.endCoalesce} onChange={(e) => actions.patchNodes(ids, { fontSize: Number(e.target.value) }, "multi-fs")} onPointerUp={actions.endCoalesce} /></Field>
        <div className="mm-row">
          <button type="button" className="mm-btn mm-btn-danger" onClick={() => actions.removeNodes(ids, false)}>Excluir selecionados</button>
        </div>
      </div>
    );
  }

  if (edge) {
    const autoColor = edge.color === undefined;
    return (
      <div className="mm-panel-body">
        <h3 className="mm-panel-title">Seta / conexão {edge.origin === "ai" ? <span className="mm-tag">IA</span> : null}{edge.inferred ? <span className="mm-tag mm-tag-warn">sugestão</span> : null}</h3>
        <Field label="Texto na linha">
          <input className="mm-input" value={edge.label ?? ""} placeholder="ex.: inibe, causa, leva a…" onFocus={actions.endCoalesce} onBlur={actions.endCoalesce} onChange={(e) => actions.patchEdge(edge.id, { label: e.target.value.slice(0, 80) }, `el-${edge.id}`)} />
        </Field>
        <Field label="Cor"><Swatches value={edge.color} allowAuto onAuto={() => actions.patchEdge(edge.id, { color: undefined })} onPick={(c) => actions.patchEdge(edge.id, { color: c === "gray" ? "#5b6675" : paletteStyle(c).border })} /></Field>
        {autoColor && <small className="mm-hint">Cor automática: segue o ramo.</small>}
        <Field label="Espessura">
          <Seg value={String(edge.width ?? (edge.kind === "tree" ? 3 : 2)) as string} options={[["1", "Fina"], ["2", "Média"], ["3", "Grossa"], ["5", "Extra"]]} onChange={(v) => actions.patchEdge(edge.id, { width: Number(v) })} />
        </Field>
        <Field label="Estilo da linha">
          <Seg<Curve> value={edge.curve ?? "bezier"} options={[["bezier", "Curva"], ["straight", "Reta"], ["step", "Em degraus"]]} onChange={(v) => actions.patchEdge(edge.id, { curve: v })} />
        </Field>
        <div className="mm-row">
          <button type="button" className={`mm-btn${edge.dashed ? " on" : ""}`} onClick={() => actions.patchEdge(edge.id, { dashed: !edge.dashed })}>Tracejada</button>
          <button type="button" className={`mm-btn${edge.arrowEnd ? " on" : ""}`} onClick={() => actions.patchEdge(edge.id, { arrowEnd: !edge.arrowEnd })}>Seta no fim</button>
          <button type="button" className={`mm-btn${edge.arrowStart ? " on" : ""}`} onClick={() => actions.patchEdge(edge.id, { arrowStart: !edge.arrowStart })}>Seta no início</button>
        </div>
        <Field label="Tipo">
          <Seg<EdgeKind> value={edge.kind} options={[["tree", "Hierarquia"], ["link", "Conexão livre"]]} onChange={(v) => actions.setEdgeKind(edge.id, v)} />
        </Field>
        <div className="mm-row">
          <button type="button" className="mm-btn" onClick={() => actions.reverseEdge(edge.id)}>Inverter direção</button>
          <button type="button" className="mm-btn mm-btn-danger" onClick={() => actions.removeEdges([edge.id])}>Excluir seta</button>
        </div>
      </div>
    );
  }

  const node = nodes[0];
  const d = node.data;
  const kids = childrenOf(doc, node.id).length;
  const parent = parentOf(doc, node.id);
  const title = node.kind === "concept" ? "Conceito" : node.kind === "note" ? "Caixa de texto" : "Imagem";
  const patch = (p: Partial<NodeData>, coalesce?: string) => actions.patchNodes([node.id], p, coalesce);

  return (
    <div className="mm-panel-body">
      <h3 className="mm-panel-title">{title} {d.origin === "ai" ? <span className="mm-tag">IA</span> : null}{d.edited ? <span className="mm-tag mm-tag-edit">editado por você</span> : null}</h3>
      {d.inferred && <p className="mm-warn">Sugestão da IA que não está nas suas anotações. Confira antes de estudar por ela. Ao editar o texto, este aviso some.</p>}

      {node.kind === "image" ? (
        <>
          <Field label="Legenda"><input className="mm-input" value={d.label} onFocus={actions.endCoalesce} onBlur={actions.endCoalesce} onChange={(e) => patch({ label: e.target.value.slice(0, 200) }, `lb-${node.id}`)} /></Field>
          <Field label="Recortar (% retirado de cada lado)">
            {(["t", "r", "b", "l"] as (keyof Crop)[]).map((side) => (
              <label key={side} className="mm-range">
                <span>{{ t: "Topo", r: "Direita", b: "Base", l: "Esquerda" }[side]}</span>
                <input type="range" min={0} max={80} value={Math.round((d.crop?.[side] ?? 0) * 100)} onPointerDown={actions.endCoalesce} onPointerUp={actions.endCoalesce} onChange={(e) => patch({ crop: { l: 0, t: 0, r: 0, b: 0, ...d.crop, [side]: Number(e.target.value) / 100 } }, `crop-${node.id}`)} />
              </label>
            ))}
            <button type="button" className="mm-btn" onClick={() => patch({ crop: { l: 0, t: 0, r: 0, b: 0 } })}>Remover recorte</button>
          </Field>
          <Field label="Borda"><Swatches value={d.color} onPick={(c) => patch({ color: c })} /></Field>
          <button type="button" className="mm-btn" onClick={() => actions.replaceImage(node.id)}>Trocar imagem</button>
          <small className="mm-hint">Arraste os cantos da imagem no mapa para redimensionar.</small>
        </>
      ) : (
        <>
          <Field label={node.kind === "note" ? "Texto" : "Nome do conceito"}>
            <textarea className="mm-input" rows={node.kind === "note" ? 5 : 2} value={d.label} onFocus={actions.endCoalesce} onBlur={actions.endCoalesce} onChange={(e) => patch({ label: e.target.value.slice(0, 600) }, `lb-${node.id}`)} />
          </Field>
          {node.kind === "concept" && (
            <Field label="Observação / explicação">
              <textarea className="mm-input" rows={3} value={d.detail ?? ""} placeholder="Definição, mecanismo, lembrete…" onFocus={actions.endCoalesce} onBlur={actions.endCoalesce} onChange={(e) => patch({ detail: e.target.value.slice(0, 800) }, `dt-${node.id}`)} />
              <label className="mm-check"><input type="checkbox" checked={!!d.showDetail} onChange={(e) => patch({ showDetail: e.target.checked })} /> Mostrar a observação dentro do conceito</label>
            </Field>
          )}
          <Field label="Cor"><Swatches value={d.color} onPick={(c) => patch({ color: c })} /></Field>
          {node.kind === "concept" && (
            <Field label="Forma">
              <Seg<Shape> value={d.shape ?? "rounded"} options={[["rounded", "Arredond."], ["pill", "Pílula"], ["rect", "Retângulo"], ["ellipse", "Oval"]]} onChange={(v) => patch({ shape: v })} />
            </Field>
          )}
          <Field label="Texto">
            <Seg value={d.font ?? "sans"} options={[["sans", "Sem serifa"], ["serif", "Serifada"], ["mono", "Mono"]]} onChange={(v) => patch({ font: v })} />
            <div className="mm-row">
              <input type="range" min={11} max={30} value={d.fontSize ?? (node.kind === "note" ? 13 : 15)} aria-label="Tamanho do texto" onPointerDown={actions.endCoalesce} onPointerUp={actions.endCoalesce} onChange={(e) => patch({ fontSize: Number(e.target.value) }, `fs-${node.id}`)} />
              <button type="button" className={`mm-btn mm-btn-sq${d.bold ? " on" : ""}`} onClick={() => patch({ bold: !d.bold })} aria-pressed={!!d.bold}><b>N</b></button>
              <button type="button" className={`mm-btn mm-btn-sq${d.italic ? " on" : ""}`} onClick={() => patch({ italic: !d.italic })} aria-pressed={!!d.italic}><i>I</i></button>
            </div>
          </Field>
          {node.kind === "concept" && (
            <Field label="Borda">
              <Seg value={d.borderStyle ?? "solid"} options={[["none", "Sem"], ["solid", "Sólida"], ["dashed", "Tracejada"]]} onChange={(v) => patch({ borderStyle: v })} />
              <Seg value={String(d.borderWidth ?? 2)} options={[["1", "1"], ["2", "2"], ["3", "3"], ["5", "5"]]} onChange={(v) => patch({ borderWidth: Number(v) })} />
            </Field>
          )}
          <SourceLink node={node} pages={pages} actions={actions} />
        </>
      )}

      {node.kind === "concept" && (
        <Field label="Hierarquia">
          <select className="mm-input" value={parent ?? ""} onChange={(e) => actions.reparent(node.id, e.target.value || null)} aria-label="Mover para dentro de">
            <option value="">(Tema principal, sem pai)</option>
            {parent && !parentOptions.some((o) => o.id === parent) && <option value={parent}>{nodeById(doc, parent)?.data.label}</option>}
            {parentOptions.map((o) => <option key={o.id} value={o.id}>{o.data.label.slice(0, 60)}</option>)}
          </select>
          <div className="mm-row">
            <button type="button" className="mm-btn" onClick={() => actions.addChild(node.id)}>+ Filho</button>
            <button type="button" className="mm-btn" onClick={() => actions.addSibling(node.id)}>+ Irmão</button>
            {kids > 0 && <button type="button" className="mm-btn" onClick={() => actions.toggle(node.id)}>{d.collapsed ? `Expandir (${kids})` : `Recolher (${kids})`}</button>}
          </div>
        </Field>
      )}

      <div className="mm-row">
        {node.kind !== "image" && <button type="button" className="mm-btn" onClick={() => actions.startEdit(node.id)}>Escrever no mapa</button>}
        <button type="button" className="mm-btn mm-btn-danger" onClick={() => actions.removeNodes([node.id], false)}>{kids ? "Excluir (mantém filhos)" : "Excluir"}</button>
        {kids > 0 && <button type="button" className="mm-btn mm-btn-danger" onClick={() => actions.removeNodes([node.id], true)}>Excluir ramo inteiro</button>}
      </div>
    </div>
  );
}
