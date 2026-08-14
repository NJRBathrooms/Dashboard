# Spec — Lançamentos Rápidos — Drywall (NJR Bathrooms)

Data: 2026-08-11
App: `index.html` (admin). Backend: `api/_actions.js`, `api/write.js`, `api/_google.js`.
Sem novos endpoints serverless.

## Objetivo

Criar um controle paralelo e leve para projetos de drywall, onde a NJR contrata equipes de
outras companhias pagando **diária por pessoa**, e a mesma diária pode atender vários endereços
no mesmo dia. O fluxo atual (Incluir Obra → horas/materiais/subcontratos) continua intacto e
segue sendo usado para as obras de bathroom/tile.

## Decisões (brainstorming)

1. **Rateio automático da diária** — a diária de uma pessoa num dia é dividida igualmente entre
   os endereços que ela atendeu naquele dia.
2. **Granularidade: pessoa individual** — cada pessoa tem nome, companhia e diária própria.
3. **Receita por endereço/serviço** — cada serviço tem um valor cobrado do cliente; com o custo
   rateado, o app mostra o lucro por serviço.
4. **Serviço persiste entre dias** — normalmente fecha em 1 dia, mas pode acumular diárias de
   dias diferentes.
5. **Custo = só diárias** — sem controle de material nesse fluxo.
6. **Sem controle de pagamento** das equipes (é resolvido fora do app).
7. **Aba única e desnormalizada** na planilha (escolha do usuário sobre alternativas
   normalizadas), com as salvaguardas descritas em "Integridade" abaixo.
8. **Formato do lançamento: uma linha por serviço executado**, com rateio recalculado na leitura.
9. **Visão: lista do período com totais** (não uma tela por serviço).

## Estrutura de dados

**Aba única `Drywall`**, criada automaticamente no primeiro lançamento (mesmo padrão de
`ensureSubProfSheet` / `ensureRateHistSheet`):

```
Carimbo de data/hora | Data | Cliente | Endereço | Valor Cobrado ($) | Pessoa | Companhia | Diária ($) | Observações
```

Cada linha = **um lançamento**: uma pessoa, um dia, um serviço.

| Situação | Linha gravada |
|---|---|
| Serviço novo + pessoa trabalhou | Linha completa, **com** `Valor Cobrado` |
| Mesma pessoa volta em outro dia | Nova linha, `Valor Cobrado` **vazio** |
| Outra pessoa no mesmo serviço | Nova linha, `Valor Cobrado` **vazio** |
| Serviço criado sem execução ainda | Linha com cliente/endereço/valor e `Pessoa` **vazia** |

### Chaves de agrupamento

O `Endereço` é o **identificador do serviço** — é por ele que receita e custos se juntam. Dois
serviços distintos não podem compartilhar o mesmo endereço; se o mesmo endereço for atendido em
momentos diferentes, é tratado como o mesmo serviço.

Tanto `Endereço` quanto `Pessoa` são comparados de forma normalizada (sem diferenciar
maiúsculas/minúsculas e com espaços colapsados), usando os helpers `normAddr`/`normStr` já
existentes. Isso evita que "12 Oak St" e "12 oak st " virem dois serviços diferentes.

### Integridade (mitiga o risco da desnormalização)

- **`Valor Cobrado` é gravado uma única vez por endereço** — a UI só pergunta esse campo ao
  criar um serviço novo; ao lançar em serviço existente o campo não aparece.
- **Na leitura, a receita de um endereço é o primeiro `Valor Cobrado` não-vazio** daquele
  endereço (ordenado por Carimbo). Mesmo que apareça repetido, nunca é somado duas vezes.
- **A `Diária` é gravada em cada lançamento** (snapshot), não buscada de um cadastro. Reajustar
  a diária de alguém não altera lançamentos passados.

## Cálculos (todos derivados na leitura, nada regravado)

- **Custo do lançamento** = `Diária ÷ (nº de lançamentos da mesma Pessoa + mesma Data)`
- **Custo do serviço** = soma dos custos rateados dos lançamentos daquele endereço
- **Receita do serviço** = primeiro `Valor Cobrado` não-vazio daquele endereço
- **Lucro do serviço** = receita − custo
- **Lista de pessoas** (dropdown) = valores distintos de `Pessoa`, cada uma com a `Diária` e a
  `Companhia` do lançamento mais recente dela
- **Lista de serviços** (dropdown) = valores distintos de `Endereço`, com o cliente associado

Consequência do rateio derivado: adicionar um 4º endereço ao dia de uma pessoa reajusta
automaticamente os outros três, sem regravar nenhuma linha.

## Telas

### Nova aba `Drywall` (tab 8)

Rótulo curto na barra de navegação (que já rola horizontalmente com 7 abas); o título
"Lançamentos Rápidos — Drywall" aparece dentro da tela.

Formulário de lançamento:
- **Data** (padrão: hoje)
- **Pessoa** — dropdown do histórico, ou "+ nova pessoa" (Nome, Companhia, Diária)
- **Diária ($)** — pré-preenchida a partir da pessoa escolhida, editável
- **Serviço** — dropdown dos endereços existentes, ou "+ novo serviço" (Cliente, Endereço,
  Valor Cobrado)
- **Observações** (opcional) — campo livre, gravado na coluna `Observações`
- Botão **+ Lançar**

Abaixo do formulário, a lista dos lançamentos da data selecionada, mostrando para cada linha o
custo rateado, a fração da diária (ex.: "1/3 da diária") e um botão de excluir; ao final, o
custo total do dia.

### Aba `Controle de Obras` — duas sub-abas

Usa o padrão `subtab-btn` já existente no app (abas 2, 3, 4 e Insurance).

- **Obras Bathroom/Tile** — a tela atual, sem nenhuma alteração de comportamento
- **Obras Drywall** — lista do período:
  - Cards de topo: Receita, Custo, Lucro e Margem do mês
  - Tabela: Cliente | Endereço | Receita | Custo | Lucro, com linha de TOTAL
  - Navegador de mês (`‹ AGOSTO 2026 ›`), mesmo padrão do app de aluguéis

**Regra de período:** um serviço pertence ao mês do seu primeiro lançamento (data de início) e
aparece nele com receita e custo integrais, mesmo que alguma diária tenha caído no mês seguinte.
Isso evita receita e custo em meses diferentes, o que distorceria a margem.

## Backend

- **Nenhuma função serverless nova** — o projeto está em 12/12 no limite do plano Vercel Hobby.
  Novas ações registradas no `api/write.js` existente: `addDrywall`, `updateDrywall`,
  `deleteDrywall` (implementadas em `api/_actions.js`).
- **`readAll` em `api/_google.js`** passa a devolver `drywall`, localizando a aba por
  `findValues(byTitle, ['pessoa', 'diária'])` — nenhuma aba atual possui essas duas colunas,
  então não há risco de casar com a aba errada.
- Todo o cálculo do rateio é feito no cliente, como já ocorre com os custos de obra.

## Melhoria incluída no escopo

Portar do `rentals.html` para o `index.html` a proteção contra duplo toque:
- guarda de requisições idênticas em voo dentro do `apiWrite`
- helper `runBtn` (botão travado + spinner) aplicado ao botão "+ Lançar"

Justificativa: numa tela de lançamento rápido o duplo toque não cria apenas uma linha extra —
ele **altera o rateio de todos os outros lançamentos daquele dia** (4 linhas em vez de 3 faz cada
custo cair de $66,67 para $50), espalhando o erro em vez de isolá-lo. O `apiWrite` do
`index.html` hoje não tem nenhuma proteção.

## Fora de escopo

- Controle de material nos serviços de drywall
- Controle de pagamento das equipes (pago/pendente)
- Status de conclusão do serviço (em andamento / concluído)
- Qualquer alteração no app dos funcionários (`employees.html`) — as equipes de drywall são de
  terceiros e não usam o app de horas
- Qualquer alteração no fluxo Bathroom/Tile: `calcAddr`, gráficos, invoice, Registros,
  Fechar/Consultar permanecem intactos
- Compliance Insurance & W9 das companhias de drywall (fluxo já existente e independente)

## Verificação

1. Lançar Carlos ($200) em 3 endereços no mesmo dia → cada lançamento custa $66,67; total do dia
   $200,00.
2. Adicionar um 4º endereço no mesmo dia → os quatro passam a $50,00 sem regravar linhas.
3. Lançar Carlos no dia seguinte em 1 endereço → esse lançamento custa $200,00 (diária inteira).
4. Criar serviço com Valor Cobrado $800 e aplicar 2 diárias → receita continua $800 (não dobra).
5. Serviço criado sem execução → aparece na lista com custo $0 e lucro = receita.
6. Alterar a diária de uma pessoa num lançamento novo → lançamentos anteriores mantêm o valor
   antigo.
6b. Lançar no mesmo endereço digitado com caixa/espaçamento diferente ("12 oak st ") → cai no
   mesmo serviço, sem duplicar.
7. Duplo toque em "+ Lançar" → grava apenas um lançamento.
8. Aba Obras Bathroom/Tile → comportamento idêntico ao atual (nenhuma regressão).
9. `node --check` nos `.js`; extração e check do JS do `index.html`; contagem de divs; conferir
   que `api/*.js` sem underscore continua em 12 arquivos.
