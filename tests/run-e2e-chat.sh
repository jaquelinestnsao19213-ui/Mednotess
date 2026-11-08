#!/bin/sh
# Roda o teste de ponta a ponta da rota /api/chat: compila o app apontando para os servidores simulados.
# Uso: sh tests/run-e2e-chat.sh
set -e
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=x
npx next build >/tmp/e2e-build.log 2>&1 || { tail -30 /tmp/e2e-build.log; exit 1; }
ANTHROPIC_API_KEY=teste-key ANTHROPIC_BASE_URL=http://127.0.0.1:54322 CHAT_DEADLINE_MS=2500 npx next start -p 3100 >/tmp/chat-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 4
SERVER_LOG=/tmp/chat-server.log node tests/e2e-chat.mjs
