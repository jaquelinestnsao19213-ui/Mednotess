# Meus cadernos

Cadernos com subpáginas, login, salvamento automático, editor Tiptap e transcrição integrada, usando Next.js + Supabase.

## Rodar no computador
1. `npm install`
2. Copie `.env.example` para `.env.local` e configure `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Configure `OPENAI_API_KEY` e `ANTHROPIC_API_KEY` apenas no ambiente do servidor (local/Vercel). Não use prefixo `NEXT_PUBLIC_` nestas chaves.
4. `npm run dev` e abra http://localhost:3000

## Transcrição integrada
Dentro de uma página ou aula, use a barra “Peça à IA” e confirme que tem autorização para gravar. A gravação é dividida em segmentos curtos processados por requisições independentes, sem manter uma única requisição HTTP aberta durante a aula. As anotações são pré-visualizadas e podem ser inseridas ao final do conteúdo atual. O áudio não é gravado no banco de dados nem armazenado pela aplicação; os segmentos são enviados à OpenAI e o texto à Anthropic, sujeitos às políticas de retenção desses provedores.

## Publicar na Vercel
Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `OPENAI_API_KEY` e `ANTHROPIC_API_KEY` nas variáveis do projeto. Chaves OpenAI e Anthropic devem permanecer exclusivamente no servidor.
