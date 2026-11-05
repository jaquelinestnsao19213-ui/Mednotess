"use client";

// Em vez da tela em branco, mostra o erro real para a gente conseguir corrigir.
export default function ErroDaPagina({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ padding: 20, fontFamily: "system-ui, sans-serif" }}>
      <h2 style={{ margin: "0 0 8px" }}>Algo deu errado nesta página</h2>
      <p style={{ margin: "0 0 12px", color: "#5b6672" }}>Tire um print desta tela e envie para o Claude.</p>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          background: "#f1f3f6",
          padding: 12,
          borderRadius: 8,
          fontSize: 12,
          maxHeight: "50vh",
          overflow: "auto",
        }}
      >
        {error.name}: {error.message}
        {"\n\n"}
        {(error.stack ?? "").split("\n").slice(0, 8).join("\n")}
      </pre>
      <button type="button" onClick={reset} style={{ marginTop: 12, padding: "10px 16px", borderRadius: 8 }}>
        Tentar de novo
      </button>
    </main>
  );
}
