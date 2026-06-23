# Setup — Credencial Google (OAuth) para o backend rápido

O backend agora fala **direto** com a Google Sheets API + Drive API (sem Apps Script),
rodando **como você** via um "refresh token" OAuth. Faça este setup UMA vez (~10 min).

> ⚠️ Não publique o app na Vercel antes de terminar este setup — sem as credenciais,
> o app novo não consegue autenticar. (O Claude só faz o push depois que você confirmar.)

---

## Parte A — Google Cloud (criar a credencial)

1. Acesse **console.cloud.google.com** e crie/selecione um projeto (ex.: "NJR App").

2. **Ativar as APIs**: menu → "APIs e serviços" → "APIs e serviços ativados" →
   "+ ATIVAR APIS E SERVIÇOS" → ative:
   - **Google Sheets API**
   - **Google Drive API**

3. **Tela de consentimento OAuth** ("APIs e serviços" → "Tela de permissão OAuth"):
   - Tipo de usuário: **Externo** → Criar
   - Nome do app: "NJR App"; e-mail de suporte e de contato: adminnjrbathrooms@gmail.com
   - Em "Escopos", adicione manualmente:
     - `https://www.googleapis.com/auth/spreadsheets`
     - `https://www.googleapis.com/auth/drive.file`
     - `https://www.googleapis.com/auth/gmail.send`
   - Salve e, no painel da tela de consentimento, clique em **"PUBLICAR APP" → confirmar**
     (status = "Em produção"). **Isso é essencial** — em modo "Teste" o token expira em 7 dias.

4. **Criar credencial OAuth** ("APIs e serviços" → "Credenciais" → "+ CRIAR CREDENCIAIS"
   → "ID do cliente OAuth"):
   - Tipo de aplicativo: **Aplicativo da Web**
   - Nome: "NJR Playground"
   - Em "URIs de redirecionamento autorizados", adicione:
     `https://developers.google.com/oauthplayground`
   - Criar → **copie o "ID do cliente" e a "Chave secreta do cliente"**.

---

## Parte B — Gerar o Refresh Token (sem programar)

5. Abra **https://developers.google.com/oauthplayground**

6. Clique na **engrenagem (⚙)** no canto superior direito:
   - Marque **"Use your own OAuth credentials"**
   - Cole o **Client ID** e o **Client Secret** do passo 4 → feche.

7. Na coluna esquerda ("Step 1"), no campo de digitar escopo, cole (separados por espaço):
   ```
   https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.send
   ```
   Clique **"Authorize APIs"**.

8. Faça login com a conta **dona da planilha**. Vai aparecer aviso de "app não verificado":
   clique em **"Avançado" → "Acessar NJR App (não seguro)" → "Permitir"**.

9. De volta ao Playground, em "Step 2", clique **"Exchange authorization code for tokens"**.
   Copie o valor de **Refresh token** (começa com `1//...`).

---

## Parte C — Variáveis na Vercel

10. Vercel → seu projeto → **Settings → Environment Variables** → adicione (em Production):

    | Nome | Valor |
    |---|---|
    | `GOOGLE_CLIENT_ID` | (ID do cliente, passo 4) |
    | `GOOGLE_CLIENT_SECRET` | (Chave secreta, passo 4) |
    | `GOOGLE_REFRESH_TOKEN` | (Refresh token, passo 9) |

    Opcional:
    | Nome | Valor |
    |---|---|
    | `NOTIFY_EMAIL` | e-mail que recebe o aviso de "material necessário amanhã" (padrão: adminnjrbathrooms@gmail.com) |

    As que já existem continuam: `JWT_SECRET`, `EMP_JWT_SECRET`, `NJR_PASSWORD`.
    `SPREADSHEET_ID` é opcional (já tem fallback no código). `APPS_SCRIPT_URL` não é mais usada.

11. Avise o Claude **"credenciais prontas"** → ele publica o código → testamos a velocidade.

---

## Observações

- **Fotos**: o app passa a criar a pasta "NJR Bathrooms - Fotos" no SEU Drive (via escopo
  `drive.file`). As fotos antigas continuam onde estão; as novas vão para essa pasta nova.
- **E-mail "material necessário amanhã"**: continua funcionando (agora via Gmail API, escopo
  `gmail.send`). O destinatário é o `NOTIFY_EMAIL` (ou adminnjrbathrooms@gmail.com por padrão).
- **Reversível**: os arquivos antigos estão em `backup/api-appsscript-2026-06-23/`.
