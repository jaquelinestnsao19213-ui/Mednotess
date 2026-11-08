// Ambiente do teste de interface da assistente: jsdom + sessão falsa do Supabase (aceita pelo servidor simulado)
import { dom } from "./ui-setup";

const storage = dom.window.localStorage;
storage.setItem("sb-127-auth-token", JSON.stringify({
  access_token: "token-yasmim", refresh_token: "r", token_type: "bearer", expires_in: 36000, expires_at: Math.floor(Date.now() / 1000) + 36000,
  user: { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", email: "x@y.z", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
}));
(dom.window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
Object.assign(globalThis, { matchMedia: (dom.window as unknown as { matchMedia: unknown }).matchMedia, innerHeight: dom.window.innerHeight });
