# Configurar o Google Drive no Mednotess

O app usa o escopo `drive.file`: só enxerga os arquivos que você escolher no seletor, nunca o Drive inteiro.
Nenhum client secret é usado; o token fica só na memória da aba.

1. Google Cloud Console → crie/escolha um projeto.
2. APIs e serviços → Biblioteca → ative **Google Drive API** e **Google Picker API**.
3. Tela de consentimento OAuth → tipo Externo → adicione seu e-mail como usuário de teste → escopo `.../auth/drive.file`.
4. Credenciais → **ID do cliente OAuth** (Aplicativo da Web). Em "Origens JavaScript autorizadas" coloque o domínio do app (https://...vercel.app) e http://localhost:3000.
5. Credenciais → **Chave de API**; restrinja por referenciador HTTP ao domínio do app e às APIs Drive/Picker.
6. Número do projeto (Início do console) = App ID.
7. Na Vercel (Settings → Environment Variables) adicione `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_API_KEY`, `NEXT_PUBLIC_GOOGLE_APP_ID` e faça novo deploy.
