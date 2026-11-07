import React, { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, Image as ImageIcon, Maximize2, Minimize2, X, FileText } from 'lucide-react';
import Markdown from './Markdown';
import { supabase } from '@/lib/supabase';
import { uploadFile } from '@/lib/upload';

interface Message {
  id: string;
  sender: 'user' | 'maria';
  text: string;
  files?: { name: string; url: string; type: string; kind?: 'image' | 'pdf' }[];
  insertText?: string | null; // sugestão de texto para inserir na página
  isError?: boolean;
  timestamp: string;
}

const MAX_PAGE_CONTEXT = 24_000;
const MAX_FILES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES = 400_000;

/** Extrai o texto simples de um documento do editor (Tiptap). */
function docToText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === 'text') return n.text ?? '';
  const inner = (n.content ?? []).map(docToText);
  const blocks = ['paragraph', 'heading', 'listItem', 'taskItem', 'tableRow', 'blockquote', 'codeBlock'];
  const text = n.type === 'tableRow' ? inner.join(' | ') : inner.join('');
  return n.type && blocks.includes(n.type) ? text + '\n' : text;
}

const nowLabel = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface PageAssistantProps {
  title?: string;
  content?: unknown;
  onInsert?: (text: string) => void;
}

export const PageAssistant: React.FC<PageAssistantProps> = ({ title, content, onInsert }) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      sender: 'maria',
      text: 'Olá, Yasmim! Sou a Maria, sua assistente acadêmica no Mednotes. Como posso ajudar nos seus estudos de Medicina hoje?',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [input, setInput] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const title_ref = useRef(title);
  const content_ref = useRef(content);
  title_ref.current = title;
  content_ref.current = content;

  // Redimensionamento automático do textarea principal
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  // Rolar para a última mensagem automaticamente
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setAttachments((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if ((!input.trim() && attachments.length === 0) || isLoading) return;

    const typed = input.trim();
    const currentAttachments = [...attachments];
    setInput('');
    setAttachments([]);
    setIsExpanded(false);
    setIsLoading(true);

    try {
      if (currentAttachments.length > MAX_FILES) throw new Error(`Envie no máximo ${MAX_FILES} arquivos por mensagem.`);

      // imagens e PDFs vão para o Storage; arquivos de texto entram direto na mensagem
      const uploaded: { name: string; url: string; type: string; kind: 'image' | 'pdf' }[] = [];
      let inlineText = '';
      for (const file of currentAttachments) {
        const lower = file.name.toLowerCase();
        if (file.type.startsWith('image/')) {
          if (file.size > MAX_IMAGE_BYTES) throw new Error('A imagem é grande demais (máx. 5 MB).');
          uploaded.push({ name: file.name, url: await uploadFile(file), type: file.type, kind: 'image' });
        } else if (file.type === 'application/pdf' || lower.endsWith('.pdf')) {
          if (file.size > MAX_PDF_BYTES) throw new Error('O PDF é grande demais (máx. 20 MB).');
          uploaded.push({ name: file.name, url: await uploadFile(file), type: file.type, kind: 'pdf' });
        } else if (file.type.startsWith('text/') || /\.(txt|md|csv|tsv)$/.test(lower)) {
          if (file.size > MAX_TEXT_FILE_BYTES) throw new Error('O arquivo de texto é grande demais.');
          inlineText += `\n\n[Arquivo: ${file.name}]\n${await file.text()}`;
        } else {
          throw new Error('Tipo de arquivo não aceito. Envie foto, PDF ou texto (.txt, .md, .csv).');
        }
      }

      const messageText = `${typed}${inlineText}`.trim() || '(arquivo enviado)';
      const userMessage: Message = {
        id: Date.now().toString(),
        sender: 'user',
        text: messageText,
        files: uploaded.length ? uploaded : undefined,
        timestamp: nowLabel()
      };
      const next = [...messages, userMessage];
      setMessages(next);

      // histórico no formato da API: até 20 mensagens, começando por uma da usuária
      const history = next
        .filter((m) => !m.isError)
        .slice(-20)
        .map((m) => ({
          role: m.sender === 'user' ? ('user' as const) : ('assistant' as const),
          content: m.text,
          attachments: m.files?.filter((f) => f.kind).map((f) => ({ url: f.url, kind: f.kind, name: f.name }))
        }));
      while (history.length && history[0].role !== 'user') history.shift();

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Sua sessão expirou. Entre novamente para continuar.');

      const pageText = docToText(content_ref.current).trim().slice(0, MAX_PAGE_CONTEXT);
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ messages: history, pageContext: { title: (title_ref.current ?? '').slice(0, 300), text: pageText } })
      });
      const data = (await response.json()) as { message?: string; insertText?: string | null; error?: string };
      if (!response.ok || !data.message) throw new Error(data.error ?? 'Não foi possível obter uma resposta agora.');

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: 'maria',
          text: data.message!,
          insertText: data.insertText?.trim() ? data.insertText : null,
          timestamp: nowLabel()
        }
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: 'maria',
          text: error instanceof Error ? error.message : 'Erro de conexão. Por favor, tente novamente.',
          isError: true,
          timestamp: nowLabel()
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  /** Insere a sugestão na página e remove o botão da mensagem. */
  const handleInsert = (msgId: string, text: string) => {
    onInsert?.(text);
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, insertText: null } : m)));
  };

  const discardInsert = (msgId: string) => {
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, insertText: null } : m)));
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100 rounded-xl overflow-hidden border border-slate-800">
      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div className="text-xs text-slate-400 mb-1">
              {msg.sender === 'user' ? 'Você' : 'Maria'} • {msg.timestamp}
            </div>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                msg.sender === 'user'
                  ? 'bg-blue-600 text-white rounded-tr-none'
                  : 'bg-slate-800 text-slate-100 border border-slate-700 rounded-tl-none'
              }`}
            >
              <Markdown text={msg.text} />
              {msg.files && msg.files.length > 0 && (
                <div className="mt-2 pt-2 border-t border-slate-700/50 space-y-1">
                  {msg.files.map((f, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs text-slate-300">
                      <FileText size={14} />
                      <span>{f.name}</span>
                    </div>
                  ))}
                </div>
              )}
              {msg.insertText && (
                <div className="mt-3 pt-3 border-t border-slate-700/50">
                  <div className="text-xs text-slate-400 mb-1">Sugestão para a página:</div>
                  <div className="max-h-48 overflow-y-auto rounded-lg bg-slate-900/70 border border-slate-700 p-2 text-sm">
                    <Markdown text={msg.insertText} />
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => handleInsert(msg.id, msg.insertText!)}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg"
                    >
                      Inserir na página
                    </button>
                    <button
                      type="button"
                      onClick={() => discardInsert(msg.id)}
                      className="px-3 py-1.5 text-slate-300 hover:bg-slate-700 text-xs rounded-lg"
                    >
                      Descartar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></div>
            <span>Maria está elaborando a resposta...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Lista de Anexos pendentes */}
      {attachments.length > 0 && (
        <div className="px-4 py-2 bg-slate-800/80 border-t border-slate-800 flex flex-wrap gap-2">
          {attachments.map((file, i) => (
            <div key={i} className="flex items-center gap-2 bg-slate-700 px-3 py-1 rounded-lg text-xs">
              <span className="truncate max-w-[150px]">{file.name}</span>
              <button onClick={() => removeAttachment(i)} className="text-slate-400 hover:text-white">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input / Controls */}
      <div className="p-3 bg-slate-950 border-t border-slate-800 flex flex-col gap-2">
        <div className="flex items-end gap-2 bg-slate-900 rounded-xl p-2 border border-slate-800 focus-within:border-blue-500 transition-all">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            multiple
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            title="Anexar arquivo"
          >
            <Paperclip size={18} />
          </button>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Digite sua dúvida acadêmica ou pressione Shift + Enter para nova linha..."
            rows={1}
            className="flex-1 bg-transparent border-0 resize-none outline-none text-slate-100 placeholder-slate-500 text-sm min-h-[36px] max-h-[200px] overflow-y-auto"
          />

          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            title="Expandir campo de escrita"
          >
            <Maximize2 size={18} />
          </button>

          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() && attachments.length === 0}
            className="p-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg transition-colors"
          >
            <Send size={18} />
          </button>
        </div>
      </div>

      {/* Modal / Área de Escrita Expandida */}
      {isExpanded && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl h-[80vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950">
              <h3 className="font-semibold text-slate-200">Editor Amplo de Comandos e Perguntas</h3>
              <button
                onClick={() => setIsExpanded(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <Minimize2 size={20} />
              </button>
            </div>
            <div className="flex-1 p-4 bg-slate-900">
              <textarea
                ref={modalTextareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Elabore perguntas complexas, adicione múltiplos parágrafos, casos clínicos ou comandos detalhados..."
                className="w-full h-full bg-transparent text-slate-100 outline-none resize-none text-base placeholder-slate-600 leading-relaxed font-sans"
              />
            </div>
            <div className="p-4 border-t border-slate-800 bg-slate-950 flex items-center justify-between">
              <div className="text-xs text-slate-500">
                {input.length} caracteres | {input.split(/\s+/).filter(Boolean).length} palavras
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setIsExpanded(false)}
                  className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg text-sm"
                >
                  Concluir Edição
                </button>
                <button
                  onClick={handleSend}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg text-sm flex items-center gap-2"
                >
                  <Send size={16} /> Enviar Pergunta
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PageAssistant;
