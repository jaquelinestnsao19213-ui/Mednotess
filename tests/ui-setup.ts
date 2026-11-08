// Prepara o ambiente de navegador (jsdom) antes de carregar os componentes.
import { JSDOM } from "jsdom";
export const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
// o Supabase do navegador (agendamento da repetição espaçada) responde com sucesso
const nodeFetch = globalThis.fetch;
if (process.env.UI_BACKEND) {
  // teste de página: URLs relativas (/api/review) vão para o servidor Next real; o resto (Supabase falso) sai normalmente
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => nodeFetch(typeof input === "string" && input.startsWith("/") ? process.env.UI_BACKEND + input : input, init)) as typeof fetch;
} else {
  // teste de componentes: o Supabase do navegador (agendamento da repetição espaçada) responde com sucesso
  globalThis.fetch = (async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
}
Object.assign(globalThis, { localStorage: dom.window.localStorage });
dom.window.scrollTo = (() => {}) as typeof dom.window.scrollTo;
dom.window.confirm = () => true;
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy";


