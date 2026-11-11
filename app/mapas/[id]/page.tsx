"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import "../../mapas.css";

const MindMapEditor = dynamic(() => import("@/components/mindmap/MindMapEditor"), { ssr: false, loading: () => <main className="shell"><p className="muted">Abrindo o mapa…</p></main> });

export default function MapaPage() {
  const { id } = useParams<{ id: string }>();
  return <MindMapEditor key={id} id={id} />;
}
