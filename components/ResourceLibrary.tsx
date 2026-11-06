"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { ResourceLink } from "@/lib/types";

type Provider = "drive" | "canva";
type LinkForm = { provider: Provider; title: string; url: string; description: string };
const EMPTY_FORM: LinkForm = { provider: "drive", title: "", url: "", description: "" };
const STARTER_LINKS = [
  { provider: "drive" as const, title: "Unisul", url: "https://drive.google.com/drive/folders/1Taltsb-T1qrNIZNNjOP6FZLnCyxEHK6N", description: "Pasta da Unisul" },
  { provider: "canva" as const, title: "Levantamento", url: "https://canva.link/edpj1qw9vd3o6ad", description: "Material no Canva" },
];
const PROVIDERS: { id: Provider; title: string; description: string; icon: string }[] = [
  { id: "drive", title: "Google Drive", description: "Pastas, livros e materiais", icon: "▰" },
  { id: "canva", title: "Canva", description: "Apresentações e designs", icon: "✿" },
];

function isHttpUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export default function ResourceLibrary() {
  const [links, setLinks] = useState<ResourceLink[]>([]);
  const [form, setForm] = useState<LinkForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const initialized = useRef(false);

  const loadLinks = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from("resource_links")
      .select("id,provider,title,url,description,created_at,updated_at")
      .order("created_at", { ascending: false });
    if (loadError) {
      setError("Não foi possível carregar a biblioteca. Confirme se schema6.sql foi executado no Supabase.");
      return false;
    }
    setLinks((data ?? []) as ResourceLink[]);
    setError(null);
    return true;
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    (async () => {
      setLoading(true);
      const { data: existing, error: readError } = await supabase
        .from("resource_links")
        .select("provider,title,url")
        .order("created_at", { ascending: false });
      if (readError) {
        setError("Não foi possível carregar a biblioteca. Confirme se schema6.sql foi executado no Supabase.");
        setLoading(false);
        return;
      }

      // Add the two links the user supplied, only if they are not already saved.
      const saved = new Set((existing ?? []).map((item) => `${item.provider}|${item.title}|${item.url}`));
      const missing = STARTER_LINKS.filter((item) => !saved.has(`${item.provider}|${item.title}|${item.url}`));
      if (missing.length) {
        const { error: seedError } = await supabase.from("resource_links").insert(missing);
        if (seedError) {
          setError("A tabela existe, mas não foi possível salvar os links iniciais. Verifique a política de acesso do Supabase.");
          setLoading(false);
          return;
        }
      }
      await loadLinks();
      setLoading(false);
    })();
  }, [loadLinks]);

  function startCreate(provider: Provider) {
    setForm({ ...EMPTY_FORM, provider });
    setEditingId(null);
    setFormOpen(true);
    setError(null);
    setMessage(null);
  }

  function startEdit(item: ResourceLink) {
    setForm({ provider: item.provider, title: item.title, url: item.url, description: item.description ?? "" });
    setEditingId(item.id);
    setFormOpen(true);
    setError(null);
    setMessage(null);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function saveLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = form.title.trim();
    const url = form.url.trim();
    if (!title) return setError("Digite o nome do material.");
    if (!isHttpUrl(url)) return setError("O link precisa começar com https:// ou http://.");
    if (saving) return;

    setSaving(true);
    setError(null);
    const values = {
      provider: form.provider,
      title,
      url,
      description: form.description.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const result = editingId
      ? await supabase.from("resource_links").update(values).eq("id", editingId)
      : await supabase.from("resource_links").insert(values);

    if (result.error) {
      setError("Não foi possível salvar o link. Confira a sessão e a tabela resource_links no Supabase.");
      setSaving(false);
      return;
    }
    closeForm();
    setMessage(editingId ? "Link atualizado." : "Link adicionado à biblioteca.");
    await loadLinks();
    setSaving(false);
  }

  async function deleteLink(item: ResourceLink) {
    if (!window.confirm(`Remover “${item.title}” da biblioteca?`)) return;
    const { error: deleteError } = await supabase.from("resource_links").delete().eq("id", item.id);
    if (deleteError) setError("Não foi possível remover este link.");
    else {
      setLinks((current) => current.filter((link) => link.id !== item.id));
      setMessage("Link removido da biblioteca.");
    }
  }

  return (
    <section className="resource-library" aria-labelledby="resource-library-title">
      <div className="resource-library-heading">
        <div>
          <span className="eyebrow">SEUS LINKS IMPORTANTES</span>
          <h2 id="resource-library-title">Biblioteca</h2>
          <p>Atalhos rápidos para suas pastas do Drive e materiais do Canva.</p>
        </div>
        <button type="button" className="resource-add-main" onClick={() => startCreate("drive")}>＋ Adicionar link</button>
      </div>

      {error && <p className="notice" role="alert">{error}</p>}
      {message && <p className="resource-feedback" role="status">{message}</p>}

      {formOpen && (
        <form className="resource-form" onSubmit={saveLink}>
          <div className="resource-form-heading">
            <div><span className="eyebrow">BIBLIOTECA PESSOAL</span><h3>{editingId ? "Editar link" : "Adicionar material"}</h3></div>
            <button type="button" className="resource-close" aria-label="Fechar formulário" onClick={closeForm}>×</button>
          </div>
          <div className="resource-form-grid">
            <label>Salvar em
              <select value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value as Provider })}>
                <option value="drive">Google Drive</option>
                <option value="canva">Canva</option>
              </select>
            </label>
            <label>Nome do material
              <input autoFocus required maxLength={120} placeholder="Ex.: Livros de graduação" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            </label>
            <label className="resource-field-wide">Link compartilhável
              <input required type="url" inputMode="url" placeholder="https://…" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} />
            </label>
            <label className="resource-field-wide">Descrição <span>(opcional)</span>
              <input maxLength={200} placeholder="Ex.: Pasta de livros do curso" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            </label>
          </div>
          <div className="row resource-form-actions">
            <button type="submit" className="resource-add-main" disabled={saving}>{saving ? "Salvando…" : editingId ? "Salvar alterações" : "Adicionar link"}</button>
            <button type="button" className="secondary" onClick={closeForm}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="resource-grid">
        {PROVIDERS.map((provider) => {
          const providerLinks = links.filter((item) => item.provider === provider.id);
          return (
            <section key={provider.id} className={`resource-panel resource-panel-${provider.id}`} aria-labelledby={`resource-title-${provider.id}`}>
              <div className="resource-panel-heading">
                <span className="resource-folder-icon" aria-hidden="true">{provider.icon}</span>
                <div className="resource-provider-copy"><h3 id={`resource-title-${provider.id}`}>{provider.title}</h3><p>{provider.description}</p></div>
                <span className="resource-count" aria-label={`${providerLinks.length} links`}>{providerLinks.length}</span>
                <button type="button" className="resource-add-small" aria-label={`Adicionar link ${provider.title}`} onClick={() => startCreate(provider.id)}>＋</button>
              </div>
              {loading ? <p className="resource-empty">Carregando links…</p> : providerLinks.length ? (
                <ul className="resource-list">
                  {providerLinks.map((item) => (
                    <li key={item.id} className="resource-item">
                      <div className="resource-item-main">
                        <span className="resource-file-icon" aria-hidden="true">↗</span>
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="resource-item-link">
                          <strong>{item.title}</strong>
                          {item.description && <small>{item.description}</small>}
                        </a>
                      </div>
                      <div className="resource-item-actions">
                        <button type="button" aria-label={`Editar ${item.title}`} onClick={() => startEdit(item)}>Editar</button>
                        <button type="button" aria-label={`Excluir ${item.title}`} onClick={() => void deleteLink(item)}>Excluir</button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="resource-empty-state"><span aria-hidden="true">✦</span><p>Ainda não há links. Adicione uma pasta ou material para encontrá-lo aqui.</p><button type="button" onClick={() => startCreate(provider.id)}>Adicionar primeiro link</button></div>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
