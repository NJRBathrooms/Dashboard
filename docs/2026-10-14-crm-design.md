# CRM — aba de relacionamento pós-obra (design aprovado em 14/10/2026)

Objetivo: o Nilmar consulta, no celular, há quanto tempo cada obra foi concluída e
recebe a mensagem pronta para o contato certo na hora certa (30 dias, 6 meses, 1 ano,
2 anos…), separando **empreiteiros** de **clientes** (moradores).

Análise que originou o projeto: doc "CRM NJR Bathrooms — análise e plano" (aba
"Obras por cliente"), 13/10/2026.

## Decisões

| # | Decisão |
|---|---|
| 1 | O tipo (Empreiteiro/Cliente) mora na **ficha do cliente**. O formulário de obra pergunta o tipo quando o cliente é novo e grava na ficha. |
| 2 | Obra ↔ cliente por **ID de cliente** (C001…). A aba abre com as fichas pré-montadas; o Nilmar revisa. |
| 3 | Ao contatar: **marcar como enviado + anotar a resposta** (guarda quem indicou quem, para o gift card). |
| 4 | **Corrigir a Data Finalização** das obras fechadas em lote, por sugestão do último dia de trabalho, com confirmação do Nilmar. |
| 5 | Envio por **SMS, WhatsApp ou copiar**, lembrando o canal de cada cliente. Tela pensada para **celular**, em **lista** (não cartões). |
| 6 | Morador autorizado pelo empreiteiro vira **contato da obra** e destrava a trilha de cliente nela. |
| 7 | Marco **não expira**: fica aberto até o Nilmar enviar ou dispensar. Marcos acumulam. |
| 8 | A **data de conclusão é sempre o ponto de partida** — inclusive para o morador autorizado. |
| 9 | Gift card de indicação ($300) **só para cliente**. |
| 10 | **"Não contatar"** na ficha suprime todos os marcos daquele cliente. |

## Dados (planilha)

Nada existente é apagado ou reordenado. Colunas novas são acrescentadas pelo sistema
(`ensureColumn`) na primeira vez que forem necessárias.

**Cadastro de Clientes** + `ID Cliente`, `Tipo`, `Canal Preferido`, `Origem`, `Não Contatar`.
- `Origem`: `Confirmado` (identidade fechada por telefone), `Inferido` (só pelo nome),
  `Nilmar` (revisado por ele). Toda edição feita pelo Nilmar grava `Nilmar`.

**Cadastro de Obras** + `ID Cliente`, `Morador Nome`, `Morador Telefone`, `Autorizado Em`,
`Conclusão Conferida`.

**CRM Contatos** (aba nova): `Carimbo de data/hora`, `ID Cliente`, `Endereço da Obra`,
`Destinatário` (Empreiteiro/Cliente), `Marco`, `Resultado` (Enviado/Dispensado), `Canal`,
`Anotação`.

Continua em 12 funções serverless: tudo entra como ação no `write.js`. A lógica de servidor
fica em `api/_crm.js` (helper, não conta como função).

## Montagem inicial das fichas (`crmPreparar`)

Ação idempotente: **só preenche o que está vazio**, nunca sobrescreve.
1. Identidade pelo **telefone** (10 últimos dígitos). Obra sem telefone entra no grupo
   cujo nome normalizado bate; senão vira grupo pelo nome.
2. Reaproveita as fichas existentes (por telefone, depois por nome).
3. `Origem`: `Confirmado` se o grupo tem telefone, senão `Inferido`.
4. `Tipo` (sempre a confirmar): `Empreiteiro` se tem empresa, se tem obras em 2+ endereços
   distintos, ou se o nome tem palavra de empresa (builders, painting, design, cabinet,
   built, homes, renovations, construction, remodel…); senão `Cliente`.
5. Nomes vazios, "Não sei" e "6s" ficam sem ficha → grupo "A identificar".
6. Não renomeia obras. Só ações explícitas do Nilmar (renomear/mover/juntar) sincronizam
   o `Nome do Cliente` das obras com a ficha.

Possíveis duplicatas são calculadas na tela, não gravadas: pares em que **ao menos um não
tem telefone** (telefones diferentes = pessoas diferentes) e que compartilham um termo
forte (≥5 letras, distância de edição ≤1, ou contido no nome do outro sem espaços).

## Data de conclusão suspeita

Sugere `último dia de trabalho` quando a Data Finalização é > 14 dias depois dele. Obra sem
horas lançadas cuja data é compartilhada por 5+ obras pede a data à mão. Até confirmar, os
marcos usam a data sugerida, sinalizada. `Manter` grava `Conclusão Conferida = Sim`.

## Marcos

| Trilha | Marco | Abre em |
|---|---|---|
| Cliente (e morador autorizado) | Fechamento | 30 dias |
| | Satisfação + indicação $300 | 6 meses |
| | Manutenção | 1 ano |
| | Manutenção (repete) | 2, 3, 4… anos |
| Empreiteiro | Pedir autorização para falar com o morador | 6 meses |
| | Manutenção / pedir telefone do morador | 1 ano |
| | Manutenção (repete) | 2, 3… anos |

- Obra em andamento não tem marco.
- Estados: futuro (cinza), aberto (laranja, clicável), enviado (verde), dispensado (cinza).
- Autorização do morador: os marcos de empreiteiro ainda abertos naquela obra viram
  "resolvido pela autorização"; o morador recebe **todos** os marcos de cliente vencidos
  desde a conclusão.
- Modal avisa sem bloquear quando o marco é antigo para a idade da obra.

## Tela

Aba **CRM** (9ª). Lista agrupada por cliente, **Empreiteiros** depois **Clientes**, da obra
mais antiga para a mais nova. No celular, linhas compactas de duas linhas; no computador,
colunas. Filtros: Abertos · Todos · A confirmar · A identificar. Busca por nome/endereço.
- ✎ na linha do cliente: editar ficha; **Confirmar** quando `Origem ≠ Nilmar`;
  **Juntar com…** quando há possível duplicata.
- ⋯ na linha da obra: mover para outro cliente, data de conclusão, autorizar morador.
- Modal de mensagem em tela cheia no celular: texto editável, WhatsApp / SMS / Copiar,
  "Enviou?" + anotação, "Não vou enviar". O canal tocado vira o canal lembrado.

## Mensagens (inglês)

Princípios: curta, um pedido só, nome e endereço, dar antes de pedir, terminar com pergunta,
regra do gift card explícita, morador sempre sabe como conseguimos o número.

- **Cliente 30 dias:** dica de cuidado (pH-neutral cleaner, sem água sanitária/vinagre no
  rejunte e pedra) + pedido de avaliação no Google. Sem link → a linha sai.
- **Cliente 6 meses:** como está a obra? + indicação: $300 gift card quando a obra
  indicada for concluída.
- **Cliente 1 ano:** manutenção — deep clean, caulk novo em todas as transições
  (piso/parede, nichos, pedra), selante de rejunte/pedra/porcelanato. Oferece orçamento.
- **Cliente 2+ anos:** manutenção recorrente, com saída educada ("if you'd rather I not
  reach out…").
- **Abertura do morador:** "{empreiteiro} from {empresa} gave me your number."
- **Empreiteiro 6 meses:** pede autorização para falar com o morador e o nome/telefone dele.
- **Empreiteiro 1 ano / 2+ anos:** manutenção — ele mesmo oferece ou passa o contato.

## Formulário de obra

Cliente existente → telefone e tipo preenchidos (tipo só leitura), obra recebe o ID.
Cliente novo → obrigatório "Este cliente é: Empreiteiro / Cliente"; a ficha nasce junto.
"Incluir Novo Cliente" ganha o mesmo campo.

## Entrega

- **Parte 1 — a base:** colunas, montagem das fichas, IDs, campo no formulário, lista com
  correção de dados e sugestão de data. Conferência pós-montagem: 9 recorrentes, 26 de uma
  obra, 21 a identificar.
- **Parte 2 — o contato:** marcos, mensagens, histórico, autorização do morador,
  "Não contatar".

## Pendente

- Link de avaliação no Google (painel do Google Business Profile ou "Escrever avaliação" na
  busca). Sem ele, a mensagem de 30 dias sai sem a linha.
- Marca do gift card.
