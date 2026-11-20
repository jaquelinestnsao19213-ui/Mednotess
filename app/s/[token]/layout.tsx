import type { Metadata } from "next";

// Páginas compartilhadas não devem aparecer em buscadores.
export const metadata: Metadata = {
  title: "Caderno compartilhado",
  robots: { index: false, follow: false },
};

export default function SharedLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
