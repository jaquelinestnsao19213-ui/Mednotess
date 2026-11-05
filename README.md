# Meus cadernos (passo 2)

Cadernos com subpáginas, login e salvamento automático, usando Next.js + Supabase.

## Rodar no computador
1. `npm install`
2. Copie `.env.example` para `.env.local` e preencha as duas chaves do Supabase
   (Project Settings > API: "Project URL" e a chave "anon" ou "publishable").
3. `npm run dev` e abra http://localhost:3000

## Publicar na Vercel
1. Suba esta pasta para um repositório novo no GitHub.
2. Na Vercel: Add New > Project > escolha o repositório.
3. Em Environment Variables, adicione `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Deploy.
