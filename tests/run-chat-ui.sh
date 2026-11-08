#!/bin/sh
# Teste de interface da assistente passando pela pilha inteira (servidor Next real + IA e Supabase simulados).
# Requer: npm i --no-save jsdom @testing-library/react @testing-library/dom @testing-library/user-event
set -e
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=x
npx next build >/tmp/ui-build.log 2>&1 || { tail -30 /tmp/ui-build.log; exit 1; }
(fuser -k 3100/tcp 2>/dev/null || true)
ANTHROPIC_API_KEY=teste-key ANTHROPIC_BASE_URL=http://127.0.0.1:54322 CHAT_DEADLINE_MS=20000 npx next start -p 3100 >/tmp/ui-server.log 2>&1 &
sleep 4
UI_BACKEND=http://127.0.0.1:3100 npx tsx --tsconfig tests/tsconfig.json --test tests/chat-ui.test.tsx
