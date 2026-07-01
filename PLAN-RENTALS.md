# NJR Casas de Aluguel — Plano de Construção

Sub-app de controle de recebimento de aluguéis e contabilidade das casas da NJR.
Stack: HTML puro (igual aos apps atuais) + backend Google Sheets/Drive/Gmail (OAuth admnjrbathrooms).
Rota: **/rentals** · Acesso: mesmo login admin (`njr_token`).

## Base de dados (planilha própria, criada automaticamente)
Nova planilha **"NJR Casas de Aluguel - Base de Dados"** (criada via API na conta admin) +
pasta no Drive **"NJR Casas de Aluguel - Documentos"** para invoices/anexos.

### Abas (tabs) e colunas
- **Casas** — cadastro mestre + parâmetros de custo por casa
  `Carimbo | Endereço | Inquilino | Contato do Inquilino | Status (Ocupada/Vacância) | Aluguel Mensal | Security Deposit | Início do Contrato | Fim do Contrato | Seguradora | Vigência do Seguro | Valor do Seguro | Periodicidade do Seguro (Mensal/Anual) | Mortgage Mensal | Valor da Água | Periodicidade da Água (Mensal/Trimestral) | Observações`
- **Recebimentos** — 1 linha por casa por competência quando o aluguel é marcado como recebido
  `Carimbo | Endereço | Competência (YYYY-MM) | Valor do Aluguel | Data do Pagamento | Multa | Total Recebido | Status | Observações`
- **Custos** — pagamentos reais (mortgage, água, seguro, outros) por competência
  `Carimbo | Endereço | Competência | Tipo (Mortgage/Água/Seguro/Outro) | Descrição | Valor | Data do Pagamento | Observações`
- **Manutenção** — formulário de manutenção nas casas
  `Carimbo | Endereço | Data de Conclusão | Competência | Tipo de Serviço | Descrição do Serviço | Empresa Subcontratada | Contato do Subcontratado | Valor do Serviço | Status Pagamento | Anexar Invoice`
- **Alertas** — controle de e-mails já enviados (evita duplicar)
  `Tipo (Contrato/Seguro) | Endereço | Marco (2m/1m) | Enviado em`

## Regras de negócio
- **Competência:** todo lançamento (aluguel, mortgage, água, seguro, manutenção) entra no mês de
  competência (ex.: aluguel de maio pago em junho → competência maio). O usuário escolhe/edita a competência.
- **Status do aluguel** (por competência, vencimento dia 1):
  - Pago (recebido) · Pendente (ainda não recebido, dentro do prazo)
  - Atrasado sem multa (dia 2–10) · **Atrasado com multa +$50** (após dia 10)
- **Security deposit:** guardado como provisão (passivo a devolver); aparece no dashboard/financeiro.
- **Vacância:** casa pode ficar sem inquilino — Status = Vacância; some dos indicadores de aluguel.
- **Tudo editável:** casas, contratos, custos, manutenção.

## Alertas por e-mail (para Paulinhajusten@hotmail.com) — via Vercel Cron diário
- **Contrato a vencer:** 2 meses e 1 mês antes de `Fim do Contrato`.
- **Seguro a vencer:** 2 meses e 1 mês antes de `Vigência do Seguro`.
- Dedupe via aba **Alertas**. Conteúdo dos e-mails: rascunhos aprovados pelo usuário.

## Telas (abas do app)
1. **Dashboard** — indicador geral + por casa: status do aluguel do mês, contrato/seguro a vencer,
   vacância; totais (recebido no mês, custos, resultado). Marcar aluguel recebido em 1 clique.
2. **Cadastros & Custos** — incluir/editar casa, contrato, seguro, mortgage, água; lançar custos.
3. **Manutenção** — formulário (autocomplete de endereço reutilizado; upload de invoice opcional).
4. **Financeiro** — contabilidade completa por competência: receitas vs custos, por casa e geral,
   resultado (lucro/prejuízo), provisões (security deposits).

## Casas iniciais (pré-cadastradas, mas permite incluir novas)
24 Whitman St, Leominster MA · 26 Whitman St, Leominster MA ·
15 Foch Ave, Fitchburg MA (downstairs) · 15 Foch Ave, Fitchburg MA (upstairs) ·
79 Appleton Cir, Fitchburg MA · 85 Edward St, Fitchburg MA

## Arquivos
- `api/_rentals.js` — base de dados (find/create planilha + tabs), leitura/escrita.
- `api/rentals-data.js` — GET dados (auth admin). `api/rentals-write.js` — POST ações (auth admin).
- `api/rentals-cron.js` — checa vencimentos e dispara e-mails (Vercel Cron diário).
- `rentals.html` — o app (4 abas). `vercel.json` — rewrite `/rentals` + cron.

## Etapas de entrega
1. Base de dados + endpoints de leitura/escrita (fundação). ← começando
2. Tela: Cadastros & Custos (CRUD de casas/contratos/custos).
3. Tela: Dashboard com indicadores + marcar recebido.
4. Tela: Manutenção (form + upload).
5. Tela: Financeiro (contabilidade por competência).
6. Cron de e-mails (contrato + seguro).
7. Teste ponta a ponta.
