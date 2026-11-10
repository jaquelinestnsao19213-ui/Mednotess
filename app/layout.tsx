import type { Metadata, Viewport } from "next";
import AuthGate from "@/components/AuthGate";
import "./globals.css";
import "./dashboard.css";
import "./resource-library.css";
import "./home-chat.css";
import "./media.css";

export const metadata: Metadata = {
  title: "Meus cadernos",
  description: "Cadernos, aulas e diário com transcrição e resumo por IA.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
