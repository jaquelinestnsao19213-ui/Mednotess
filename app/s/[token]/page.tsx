"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { SharedPage } from "@/components/SharedPageView";

const SharedPageView = dynamic(() => import("@/components/SharedPageView"), { ssr: false });

// Página pública (somente leitura): abre pelo código do link, sem precisar de conta.
export default function SharedRoute() {
  const { token } = useParams<{ token: string }>();
  const [page, setPage] = useState<SharedPage | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("get_shared_page", { token });
      if (cancelled) return;
      if (error) return setState("error");
      if (!data) return setState("missing");
      setPage(data as SharedPage);
      setState("ok");
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state === "loading") return <p className="muted">Carregando…</p>;
  if (state === "error") return <p className="empty">Não foi possível abrir esta página agora. Tente de novo em instantes.</p>;
  if (state === "missing" || !page) return <p className="empty">Esta página não está mais compartilhada ou o link está incorreto.</p>;
  return <SharedPageView page={page} />;
}
