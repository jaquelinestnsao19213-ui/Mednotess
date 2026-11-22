"use client";

import { createContext, useContext } from "react";

// Quem abre um link publicado entra em "modo visitante":
// o conteúdo da dona é só leitura e o que a pessoa anota nos PDFs fica só neste aparelho.
export type SharedView = { token: string } | null;

export const SharedViewContext = createContext<SharedView>(null);

export function useSharedView(): SharedView {
  return useContext(SharedViewContext);
}

// Onde as anotações do visitante ficam guardadas (neste aparelho), uma chave por PDF.
export const sharedAnnKey = (url: string) => `mednotes:shared-ann:${url}`;

// Marcador usado pelo envio de imagens: visitante não tem conta, então a imagem fica embutida no comentário.
let visitor = false;
export function setVisitorMode(on: boolean) {
  visitor = on;
}
export function isVisitorMode(): boolean {
  return visitor;
}
