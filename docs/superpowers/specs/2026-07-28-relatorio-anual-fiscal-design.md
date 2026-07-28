# Spec — Relatório Anual (Ano Fiscal) para o Contador

Data: 2026-07-28
App: `rentals.html` (aba 5 — Financeiro). Backend inalterado, sem novos endpoints.

## Objetivo
Permitir que a NJR Casas de Aluguel gere, no fim do ano fiscal, um relatório consolidado de
receitas e despesas por casa — pronto para enviar ao contador — reaproveitando os lançamentos
já feitos ao longo do ano (recebimentos, custos, manutenção, mortgage fixo).

## Contexto / decisões (brainstorming)
1. **Formato de saída:** CSV detalhado (uma linha por lançamento) **+** PDF resumido por casa
   (via impressão do navegador, mesmo padrão do invoice já existente no app NJR Bathrooms).
2. **Categorização:** os "Tipo" já lançados hoje (Água, Seguro, Mortgage, Outro, TIPOS_SERVICO de
   manutenção) são mapeados para categorias contábeis padrão — sem precisar recadastrar nada
   retroativamente, o mapeamento é aplicado na hora de montar o relatório.
3. **Mortgage:** exportado como valor total pago (principal + juros + escrow, como já é lançado
   hoje); a separação entre juros dedutíveis e principal fica a cargo do contador.
4. **Ano fiscal:** ano calendário (jan–dez), padrão dos EUA para pessoa física / LLC.
5. **Sem novo backend:** já no limite de 12 funções serverless do Vercel Hobby. O relatório é
   montado 100% no cliente a partir de `DB.recebimentos`, `DB.custos`, `DB.manutencao`, `DB.casas`
   (já carregados por `loadData()`). Nenhuma mudança de schema na planilha.

## Mapeamento de categoria fiscal
Função pura `categoriaFiscal(item)`, aplicada a cada lançamento na hora de montar o relatório:

| Origem do lançamento | Categoria fiscal |
|---|---|
| `DB.recebimentos` (Total Recebido) | Rental Income |
| `DB.custos` com `Tipo` = "Seguro" | Insurance |
| `DB.custos` com `Tipo` = "Água" | Utilities |
| `Mortgage Mensal` fixo do cadastro da casa (gerado 1x por mês/casa, igual ao Financeiro mensal já faz) | Mortgage Payment (Interest & Principal) |
| `DB.manutencao` (qualquer `Tipo de Serviço`: Plumbing, Painting, Drywall, Electrical, General Contracting, Plastering, Others) | Repairs & Maintenance |
| `DB.custos` com `Tipo` = "Outro" (ou qualquer tipo não mapeado acima) | Other Expenses |

Água repassada ao inquilino continua entrando dos dois lados (receita, dentro do recebimento; e
despesa, em Utilities) — mesmo tratamento que o Financeiro mensal já usa hoje, e consistente com
como o IRS trata reembolso de despesas pelo inquilino (soma na receita bruta e continua dedutível).

## Layout (novo card, dentro da aba Financeiro existente)
Adicionado **abaixo** do card mensal atual (`renderFin`), mesma aba:

1. **Título + seletor de ano:** "Relatório Anual" com navegador `← <Ano> →` (padrão = ano corrente,
   mesmo padrão visual do navegador de mês do Dashboard).
2. **Tabela por casa** (uma linha por casa, ano selecionado):
   `Casa | Rental Income | Insurance | Utilities | Repairs & Maintenance | Mortgage | Other | Custo Total | Resultado Líquido`
   - Linha final `TOTAL` somando todas as casas.
3. **Nota de Security Deposits** (fora da tabela de P&L, só informativo): lista o valor de
   `Security Deposit` atual por casa — não entra como receita/despesa, é só referência para o
   contador saber quanto está retido.
4. **Botões de exportação:**
   - **Baixar CSV** — gera e baixa (via `Blob` + link temporário, sem backend) um CSV com uma
     linha por lançamento do ano inteiro: `Casa, Data, Categoria Fiscal, Descrição, Receita ($),
     Despesa ($), Competência`.
   - **Baixar PDF (resumo)** — abre uma view de impressão (nova janela/seção com CSS de print,
     igual ao invoice do app NJR Bathrooms) com a tabela por casa + totais + nota de depósitos,
     cabeçalho "NJR Casas de Aluguel — Relatório Anual `<ano>`". O usuário salva como PDF pelo
     diálogo de impressão do navegador.

## Dados / endpoints
- **Leitura:** apenas os arrays já carregados por `loadData()` (`DB.casas`, `DB.recebimentos`,
  `DB.custos`, `DB.manutencao`) — mesma fonte que o Financeiro mensal usa hoje, filtrando por ano
  em vez de competência (`String(r['Competência']).startsWith(ano+'-')`).
- **Escrita:** nenhuma. Funcionalidade 100% de leitura/exportação.
- **Sem novo endpoint** — mantém a contagem de funções serverless em 12 (limite do Vercel Hobby).

## Fora de escopo
- Separação automática entre juros e principal do mortgage.
- Depreciação do imóvel (cálculo fiscal específico, fora do app).
- Envio automático de e-mail do relatório — o usuário baixa e encaminha manualmente.
- Mudança de schema na planilha ou recategorização retroativa dos dados já lançados.
- Qualquer alteração nas abas Dashboard, Cadastros, Custos ou Manutenção.
