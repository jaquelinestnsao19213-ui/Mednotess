"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import ResourceLibrary from "@/components/ResourceLibrary";

const NAV = [
  { href: "/", label: "Início" },
  { href: "/disciplinas", label: "Disciplinas" },
  { href: "/cadernos", label: "Cadernos" },
  { href: "/revisoes", label: "Revisões" },
];

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <main className="shell"><p className="muted">Carregando…</p></main>;
  if (!session) return <LoginForm />;

  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">Meus cadernos</Link>
        <button className="link-button" onClick={() => supabase.auth.signOut()}>
          Sair
        </button>
      </header>
      <nav className="mainnav" aria-label="Áreas do aplicativo">
        {NAV.map((n) => {
          const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} className={active ? "on" : ""} aria-current={active ? "page" : undefined}>
              {n.label}
            </Link>
          );
        })}
      </nav>
      <main className="shell">
        {children}
        {pathname === "/" && <ResourceLibrary />}
      </main>
    </>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMessage("Não foi possível entrar. Confira o e-mail e a senha.");
    setBusy(false);
  }

  async function signUp() {
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) setMessage(error.message);
    else if (!data.session) setMessage("Conta criada. Abra o link que enviamos para o seu e-mail e volte para entrar.");
    setBusy(false);
  }

  return (
    <main className="shell login">
      <h1 className="display">Meus cadernos</h1>
      <p className="muted">Entre para ver suas aulas, resumos e diário.</p>
      <label>
        E-mail
        <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Senha
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {message && <p className="notice">{message}</p>}
      <div className="row">
        <button className="primary" disabled={busy || !email || !password} onClick={signIn}>Entrar</button>
        <button className="secondary" disabled={busy || !email || password.length < 6} onClick={signUp}>Criar conta</button>
      </div>
    </main>
  );
}
